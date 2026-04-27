# AUDDShield v2 — Migration Plan
## Phase 1: Active Treasury + Mathematical Layer
### Breaking Changes, New Primitives, Full Execution Order

---

## Overview

v1 is a flat savings account with governance voting.
v2 is a mutual insurance protocol with capital efficiency.

The transformation requires changes at four levels:

1. **Account layout** — Pool struct expands, two new accounts created
2. **Instruction logic** — Six existing instructions break, eight new ones added
3. **Mathematical layer** — Entire new on-chain financial model (does not exist in v1)
4. **Frontend** — IDL changes, new derived state, two-step settlement flow

This document covers Phase 1 only: Active Treasury.
Phases 2-5 (Tranching, Reinsurance, Risk Pricing, Governance) are separate migration plans.

---

## Part 1: Breaking Account Changes

---

### 1.1 Pool Struct — Expansion (BREAKING)

Every existing `Pool` account deserialized against the v3 IDL will fail
after this change. This is the root breaking change.

**Fields added to `Pool`:**

```rust
pub treasury_deployed: u64,
// Capital currently sitting in external yield protocols.
// This is OUR ledger — we do not read the external protocol's state
// to get this number. Incremented on deploy_to_strategy,
// decremented on recall_from_strategy.

pub pending_claims_total: u64,
// Sum of amount_requested across ALL currently Pending requests.
// Critical: this capital is "spoken for" even though it's still
// in the vault. Cannot be deployed until the request settles.
// Updated in: submit_request (+), cancel_request (-), release_funds (-).

pub treasury_reserve_bps: u16,
// Basis points of total_balance that must stay liquid at all times.
// e.g. 2000 = 20%. u16 not u8 — basis point precision matters
// when pool balances are small (20% of 500 AUDD = 100 AUDD, not 0).

pub yield_earned_all_time: u64,
// Cumulative AUDD yield harvested back into vault across all strategies.
// Never decrements. Display metric + audit trail.

pub treasury_initialized: bool,
// Guard flag. All treasury operations require this = true.
// Set to true only by init_treasury_config.
// Prevents deploy_to_strategy being called before strategies are set.
```

**Size delta:**

```
treasury_deployed:        8 bytes
pending_claims_total:     8 bytes
treasury_reserve_bps:     2 bytes
yield_earned_all_time:    8 bytes
treasury_initialized:     1 byte
────────────────────────────────
Total delta:             +27 bytes

Pool::LEN_V2 = Pool::LEN_V3 + 27
             = 158 + 27
             = 185 bytes + 8 discriminator = 193 bytes
```

**Forward-compatibility padding:**
Add 32 bytes of `_reserved: [u8; 32]` after the new fields.
Phase 2 tranche fields will consume this space without a second realloc.
Cost: 32 lamports per pool. Worth it.

```
Pool::LEN_V2 = 193 + 32 = 225 bytes
```

---

### 1.2 New Account — `TreasuryConfig`

```
Seeds: [b"treasury_config", pool.key()]
```

```rust
#[account]
pub struct TreasuryConfig {
    pub pool:               Pubkey,       // 32
    pub reserve_bps:        u16,          // 2  — mirrors pool.treasury_reserve_bps
    pub strategies:         [StrategyAlloc; 4], // 4 * 66 = 264
    pub last_rebalance:     i64,          // 8
    pub admin_only_deploy:  bool,         // 1  — if true, only admin triggers deployments
    pub auto_harvest:       bool,         // 1  — future: permissionless harvest on contribute
    pub bump:               u8,           // 1
    pub _reserved:          [u8; 32],     // 32
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Default)]
pub struct StrategyAlloc {
    pub protocol_program:   Pubkey,       // 32 — e.g. Kamino lending program
    pub reserve_address:    Pubkey,       // 32 — specific reserve to deposit into
    pub allocation_bps:     u16,          // 2  — % of deployable capital for this strategy
    pub active:             bool,         // 1  — can be disabled without removing
    _pad:                   [u8; 3],      // 3  — alignment
}
// StrategyAlloc::LEN = 32 + 32 + 2 + 1 + 3 = 70 bytes

// TreasuryConfig::LEN = 8 + 32 + 2 + (4*70) + 8 + 1 + 1 + 1 + 32 = 365 bytes
```

**Invariant enforced at `init_treasury_config`:**

```
sum(strategies[i].allocation_bps for active i) == 10_000
```

Total allocation must equal 100% (10,000 bps). Partial allocation is rejected.
If you want to use only one strategy, set it to 10,000 bps.

---

### 1.3 New Account — `YieldPosition`

```
Seeds: [b"yield_pos", pool.key(), &[strategy_index as u8]]
```

One per active strategy per pool. Max 4 per pool.

```rust
#[account]
pub struct YieldPosition {
    pub pool:                   Pubkey,   // 32
    pub strategy_index:         u8,       // 1
    pub protocol_program:       Pubkey,   // 32
    pub reserve_address:        Pubkey,   // 32
    pub deposited_amount:       u64,      // 8  — our ledger of principal deposited
    pub receipt_token_account:  Pubkey,   // 32 — kToken/cToken account owned by pool PDA
    pub last_deploy_at:         i64,      // 8
    pub last_harvest_at:        i64,      // 8
    pub total_yield_harvested:  u64,      // 8
    pub is_active:              bool,     // 1
    pub bump:                   u8,       // 1
    pub _reserved:              [u8; 16], // 16
}
// YieldPosition::LEN = 8 + 32 + 1 + 32 + 32 + 8 + 32 + 8 + 8 + 8 + 1 + 1 + 16 = 187 bytes
```

`deposited_amount` is our internal ledger, not queried from Kamino/MarginFi.
Yield accrues inside the receipt token. We compute yield = receipt_token_balance - deposited_amount at harvest time.

---

## Part 2: Breaking Instruction Changes

---

### 2.1 `submit_request.rs` — Balance Check Rewrite (BREAKING)

**v1 check (WRONG in v2):**
```rust
require!(amount_requested <= ctx.accounts.pool.total_balance, ...);
```

`total_balance` in v2 includes deployed capital. Capital that's sitting in
Kamino is not liquid. A passed vote cannot be paid from Kamino balance without
first recalling it. Submitting a request against deployed capital creates an
impossible settlement.

**v2 check:**
```rust
let available = compute_available_for_requests(&ctx.accounts.pool)?;
require!(amount_requested <= available, AuddShieldError::InsufficientLiquidBalance);
```

Where `compute_available_for_requests` is a pure function (see Part 3: Mathematical Layer).

**Additionally, at end of handler:**
```rust
pool.pending_claims_total = pool.pending_claims_total
    .checked_add(amount_requested)
    .ok_or(AuddShieldError::Overflow)?;
```

This is a new write that did not exist in v1. Every `submit_request` now
locks that amount out of deployable capital.

---

### 2.2 `cancel_request.rs` — Decrement pending_claims_total (BREAKING)

Add to handler:
```rust
pool.pending_claims_total = pool.pending_claims_total
    .checked_sub(ctx.accounts.emergency_request.amount_requested)
    .ok_or(AuddShieldError::Overflow)?;
```

In v3 this instruction didn't touch any balance fields. Now it does.
Forgetting this creates a permanent overcounting of `pending_claims_total`
that blocks capital deployment.

---

### 2.3 `release_funds.rs` — Liquid Balance Check + pending_claims_total (BREAKING)

This is the most dangerous change. v1 checks:
```rust
require!(amount <= ctx.accounts.pool.total_balance, ...);
```

v2 must check liquid balance specifically:

```rust
// Before transfer on approval:
let liquid = compute_liquid_balance(&ctx.accounts.pool)?;
require!(amount <= liquid, AuddShieldError::InsufficientLiquidBalance);
```

And regardless of outcome (approved, rejected, expired):
```rust
pool.pending_claims_total = pool.pending_claims_total
    .checked_sub(amount)
    .ok_or(AuddShieldError::Overflow)?;
```

**New failure mode introduced**: A vote passes. `release_funds` is called.
Liquid balance is insufficient because capital is deployed.
`release_funds` fails with `InsufficientLiquidBalance`.
Caller must first call `recall_from_strategy`, then retry `release_funds`.

This is a two-step settlement flow that does not exist in v1.
Frontend must handle it. See Part 4: Frontend Changes.

**Yield on recall must NOT inflate pool.total_balance before settlement:**
When `recall_from_strategy` returns principal + yield, only the
principal portion should be counted as covering the pending claim.
Yield is credited separately to `pool.yield_earned_all_time` and
`pool.total_balance` but does not affect the settlement amount.
The request `amount_requested` field is immutable — it does not change.

---

### 2.4 `update_pool_config.rs` — Reserve BPS Field (BREAKING)

Add optional parameter:
```rust
pub fn handler(
    ctx: Context<UpdatePoolConfig>,
    new_min_contribution:           Option<u64>,
    new_vote_threshold_pct:         Option<u8>,
    new_max_members:                Option<u16>,
    new_contribution_interval_days: Option<u16>,
    new_max_request_pct:            Option<u8>,
    new_treasury_reserve_bps:       Option<u16>,  // NEW
) -> Result<()>
```

Handler addition:
```rust
if let Some(v) = new_treasury_reserve_bps {
    require!(v <= 9_000, AuddShieldError::InvalidReserveBps); // max 90% reserve
    require!(v >= 500,   AuddShieldError::InvalidReserveBps); // min 5% reserve
    pool.treasury_reserve_bps = v;
    // Sync to TreasuryConfig if initialized
    if pool.treasury_initialized {
        ctx.accounts.treasury_config.reserve_bps = v;
    }
}
```

This requires `TreasuryConfig` to be passed as an optional account.
That changes the accounts struct — breaking IDL change.

---

### 2.5 `contribute.rs` — Auto-harvest Trigger (Non-Breaking Additive, But IDL Changes)

If `treasury_config.auto_harvest == true`, contribute triggers a yield
accounting update after the deposit. This requires `TreasuryConfig` and
up to 4 `YieldPosition` accounts to be passed. Optional accounts in
Anchor 0.29 require `Option<Account<'info, T>>` — changes the accounts
struct and therefore the IDL.

This is additive but the IDL change means old clients sending the old
contribute instruction format will fail account resolution. **Breaking.**

Decision: ship auto_harvest as `false` by default. Harvest is manual via
`harvest_yield` until clients are updated. Set `auto_harvest = true` only
after frontend migration is confirmed complete.

---

## Part 3: New Mathematical Layer

This is the section that does not exist anywhere in v1.
Every formula below is new on-chain logic.

---

### 3.1 Capital Decomposition

At any moment, the pool's capital exists in one of four states:

```
pool.total_balance
    = liquid_balance + treasury_deployed

liquid_balance
    = pool.total_balance - pool.treasury_deployed

liquid_balance
    = reserved_capital
    + pending_claims_capital
    + free_deployable_capital

Where:
    reserved_capital         = total_balance * reserve_bps / 10_000
    pending_claims_capital   = pool.pending_claims_total
    free_deployable_capital  = liquid_balance
                             - reserved_capital
                             - pending_claims_capital
```

**Implementation as pure functions in `math.rs` (new file):**

```rust
pub fn compute_liquid_balance(pool: &Pool) -> Result<u64> {
    pool.total_balance
        .checked_sub(pool.treasury_deployed)
        .ok_or(error!(AuddShieldError::Overflow))
}

pub fn compute_reserve_amount(pool: &Pool) -> Result<u64> {
    (pool.total_balance as u128)
        .checked_mul(pool.treasury_reserve_bps as u128)
        .ok_or(error!(AuddShieldError::Overflow))?
        .checked_div(10_000)
        .ok_or(error!(AuddShieldError::Overflow))
        .map(|v| v as u64)
}

pub fn compute_available_for_requests(pool: &Pool) -> Result<u64> {
    let liquid    = compute_liquid_balance(pool)?;
    let reserve   = compute_reserve_amount(pool)?;
    let pending   = pool.pending_claims_total;

    liquid
        .saturating_sub(reserve)
        .checked_sub(pending)
        .ok_or(error!(AuddShieldError::InsufficientLiquidBalance))
}

pub fn compute_deployable_capital(pool: &Pool) -> Result<u64> {
    let liquid    = compute_liquid_balance(pool)?;
    let reserve   = compute_reserve_amount(pool)?;
    let pending   = pool.pending_claims_total;
    let deployed  = pool.treasury_deployed;

    liquid
        .saturating_sub(reserve)
        .saturating_sub(pending)
        .saturating_sub(deployed)
        .checked_sub(0) // identity, but keeps return type consistent
        .ok_or(error!(AuddShieldError::Overflow))
}
```

All six affected instructions import from `math.rs`.
No raw arithmetic in instruction handlers — all goes through these functions.
This is the architectural discipline v3 lacked.

---

### 3.2 Strategy Allocation Math

When `deploy_to_strategy(strategy_index, amount)` is called,
the amount must respect the strategy's `allocation_bps` ceiling.

```rust
pub fn compute_strategy_cap(
    pool: &Pool,
    config: &TreasuryConfig,
    strategy_index: usize,
) -> Result<u64> {
    let deployable = compute_deployable_capital(pool)?;
    let alloc_bps  = config.strategies[strategy_index].allocation_bps as u128;

    (deployable as u128)
        .checked_mul(alloc_bps)
        .ok_or(error!(AuddShieldError::Overflow))?
        .checked_div(10_000)
        .ok_or(error!(AuddShieldError::Overflow))
        .map(|v| v as u64)
}
```

**Invariant enforced at deploy time:**

```
position.deposited_amount + new_amount <= compute_strategy_cap(pool, config, index)
```

This prevents one strategy from consuming more than its allocated share
of deployable capital, ensuring diversification is enforced on-chain.

---

### 3.3 Yield Calculation at Harvest

Yield protocols return a receipt token (kAUDD for Kamino, equivalent for MarginFi).
The receipt token balance grows over time as interest accrues.

At harvest, yield is computed as:

```rust
pub fn compute_yield_earned(
    receipt_token_balance: u64,
    position: &YieldPosition,
) -> Result<u64> {
    // receipt_token_balance is fetched from the receipt token account
    // at harvest time via account deserialization.
    // It represents current value of our deposit in underlying AUDD terms.
    // Some protocols (Kamino) use 1:1 exchange rate tracking internally —
    // receipt_balance already equals AUDD value.
    
    receipt_token_balance
        .checked_sub(position.deposited_amount)
        .ok_or(error!(AuddShieldError::NegativeYield))
        // NegativeYield should never happen in a lending protocol
        // but we handle it defensively rather than underflowing.
}
```

After harvest, pool accounting update:

```rust
let yield_amount = compute_yield_earned(receipt_balance, &position)?;

pool.total_balance = pool.total_balance
    .checked_add(yield_amount)
    .ok_or(AuddShieldError::Overflow)?;

pool.yield_earned_all_time = pool.yield_earned_all_time
    .checked_add(yield_amount)
    .ok_or(AuddShieldError::Overflow)?;

position.total_yield_harvested = position.total_yield_harvested
    .checked_add(yield_amount)
    .ok_or(AuddShieldError::Overflow)?;

position.last_harvest_at = clock.unix_timestamp;
```

Note: `pool.treasury_deployed` does NOT change on harvest.
It only changes when principal moves in or out of the protocol.
Yield is tracked separately. This distinction is critical for accurate
capital decomposition in §3.1.

---

### 3.4 Recall Math — Principal vs Yield Separation

When `recall_from_strategy` is called, we receive back principal + yield
in a single AUDD transfer from the external protocol.

```rust
pub fn compute_recall_accounting(
    received_amount: u64,       // total AUDD returned by protocol
    position: &YieldPosition,
) -> Result<RecallResult> {
    if received_amount >= position.deposited_amount {
        let yield_amount = received_amount - position.deposited_amount;
        Ok(RecallResult {
            principal_returned: position.deposited_amount,
            yield_earned:       yield_amount,
        })
    } else {
        // Principal loss — protocol insolvency or slashing.
        // This should never happen with Kamino/MarginFi on AUDD lending,
        // but we handle it: principal is partially returned, yield = 0.
        Ok(RecallResult {
            principal_returned: received_amount,
            yield_earned:       0,
        })
    }
}
```

After recall, pool accounting update:

```rust
let result = compute_recall_accounting(received_amount, &position)?;

// Reduce deployed tracking by full deposited amount (position is now closed)
pool.treasury_deployed = pool.treasury_deployed
    .checked_sub(position.deposited_amount)
    .ok_or(AuddShieldError::Overflow)?;

// Only yield is net-new to total_balance — principal was already counted
pool.total_balance = pool.total_balance
    .checked_add(result.yield_earned)
    .ok_or(AuddShieldError::Overflow)?;

pool.yield_earned_all_time = pool.yield_earned_all_time
    .checked_add(result.yield_earned)
    .ok_or(AuddShieldError::Overflow)?;
```

**Why principal doesn't add to total_balance:**
`total_balance` represents the pool's total AUDD value including deployed capital.
When we deploy 1,000 AUDD, `total_balance` stays at its value — the 1,000 AUDD
didn't disappear, it moved from vault to Kamino, tracked via `treasury_deployed`.
When we recall, the principal comes back to the vault — no net change to
`total_balance`. Only the yield (which Kamino generated) is new value.

This is the most subtle accounting distinction in the whole system.
Getting it wrong results in either inflated or deflated `total_balance`
after every harvest cycle, which cascades into wrong reserve calculations,
wrong request availability, and wrong vote thresholds.

---

### 3.5 Reserve Ratio Enforcement — Rebalance Math

When `rebalance_treasury` is called, the system must check whether
currently deployed capital still respects the reserve ratio given
the current `total_balance` (which may have grown from yield).

```rust
pub fn compute_rebalance_delta(
    pool: &Pool,
    config: &TreasuryConfig,
) -> Result<RebalanceDelta> {
    let liquid    = compute_liquid_balance(pool)?;
    let reserve   = compute_reserve_amount(pool)?;
    let pending   = pool.pending_claims_total;

    // How much should be liquid minimum
    let required_liquid = reserve
        .checked_add(pending)
        .ok_or(error!(AuddShieldError::Overflow))?;

    if liquid >= required_liquid {
        // We have more than enough liquid — can deploy more
        let excess_liquid = liquid - required_liquid;
        Ok(RebalanceDelta::CanDeploy(excess_liquid))
    } else {
        // Liquid is insufficient — must recall
        let shortfall = required_liquid - liquid;
        Ok(RebalanceDelta::MustRecall(shortfall))
    }
}

pub enum RebalanceDelta {
    CanDeploy(u64),   // safe to deploy up to this amount more
    MustRecall(u64),  // must recall at least this amount immediately
}
```

`rebalance_treasury` instruction uses this to either:
- Trigger additional deployment across strategies (CanDeploy case)
- Trigger recall from strategies in reverse allocation order (MustRecall case)

Recall order on shortfall: recall from smallest allocation first,
preserving the highest-yield strategy as long as possible.

---

### 3.6 Capital Efficiency Metric (On-Chain + Frontend)

Stored in `TreasuryConfig` as a computed metric, updated on every
deploy/recall/harvest cycle:

```rust
pub fn compute_capital_efficiency_bps(pool: &Pool) -> u16 {
    if pool.total_balance == 0 { return 0; }
    
    // % of total capital that is earning yield
    // Expressed in basis points (10_000 = 100%)
    let efficiency = (pool.treasury_deployed as u128)
        .saturating_mul(10_000)
        / pool.total_balance as u128;
    
    efficiency.min(10_000) as u16
}
```

This metric is displayed in the frontend as "Treasury Efficiency: 73%"
meaning 73% of the pool's capital is actively earning yield.
The target range is (reserve_bps) to (10_000 - reserve_bps - pending_bps).

For a 20% reserve pool with no pending claims, maximum theoretical efficiency = 80%.

---

### 3.7 Annualised Yield Rate Estimation

Not stored on-chain (requires time-series data impractical for SVM).
Computed client-side in `usePool.ts`:

```typescript
function computeAnnualisedYieldBps(
    yieldEarnedAllTime: number,
    totalContributedAllTime: number,
    createdAt: number,
    now: number
): number {
    const ageSeconds = now - createdAt;
    if (ageSeconds < 86400) return 0; // too young to estimate
    
    const yearFraction = ageSeconds / (365 * 24 * 60 * 60);
    
    // Yield as fraction of average deployed capital
    // Approximate: use totalBalance as proxy for average deployed
    const yieldRate = yieldEarnedAllTime / totalContributedAllTime;
    const annualised = yieldRate / yearFraction;
    
    return Math.round(annualised * 10_000); // basis points
}
```

Displayed in UI as "Est. APY: 4.2%". Clearly marked as estimate.

---

### 3.8 Deployable Capital Per Strategy — Allocation Enforcement

When multiple strategies are active, total deployed across all strategies
must respect each strategy's `allocation_bps` ceiling AND the global
`compute_deployable_capital` ceiling:

```rust
pub fn compute_strategy_current_allocation_bps(
    position: &YieldPosition,
    pool: &Pool,
) -> u16 {
    if pool.total_balance == 0 { return 0; }
    
    ((position.deposited_amount as u128)
        .saturating_mul(10_000)
        / pool.total_balance as u128)
        .min(10_000) as u16
}

pub fn validate_strategy_allocation(
    new_amount: u64,
    position: &YieldPosition,
    config: &TreasuryConfig,
    pool: &Pool,
    strategy_index: usize,
) -> Result<()> {
    let cap = compute_strategy_cap(pool, config, strategy_index)?;
    let new_total = position.deposited_amount
        .checked_add(new_amount)
        .ok_or(AuddShieldError::Overflow)?;
    
    require!(new_total <= cap, AuddShieldError::StrategyCapExceeded);
    Ok(())
}
```

---

### 3.9 Emergency Recall Sizing — Settlement Safety

When a claim is approved and liquid balance is insufficient,
the caller needs to know exactly how much to recall to make
`release_funds` succeed. This is a client-side computation:

```typescript
function computeRecallNeeded(
    pool: PoolData,
    claimAmount: number
): number {
    const liquid = pool.totalBalance - pool.treasuryDeployed;
    if (liquid >= claimAmount) return 0; // no recall needed
    return claimAmount - liquid; // minimum recall amount
}
```

The frontend uses this in the two-step settlement flow (see Part 4).

---

## Part 4: New Instructions

---

### 4.1 `migrate_pool_v2`

```rust
#[derive(Accounts)]
pub struct MigratePoolV2<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(
        mut,
        realloc = Pool::LEN_V2,
        realloc::payer = admin,
        realloc::zero = false,
        constraint = pool.admin == admin.key()          @ AuddShieldError::NotAdmin,
        constraint = !pool.treasury_initialized         @ AuddShieldError::AlreadyMigrated,
        constraint = pool.pending_requests == 0         @ AuddShieldError::PoolHasPendingRequests,
    )]
    pub pool: Account<'info, Pool>,
    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<MigratePoolV2>) -> Result<()> {
    let pool = &mut ctx.accounts.pool;
    pool.treasury_deployed      = 0;
    pool.pending_claims_total   = 0;
    pool.treasury_reserve_bps   = 2000;
    pool.yield_earned_all_time  = 0;
    pool.treasury_initialized   = false; // requires init_treasury_config next
    Ok(())
}
```

**Constraint rationale:**
`pending_requests == 0` enforced because we cannot reconstruct
`pending_claims_total` without iterating all request accounts on-chain.
Admin must wait for all pending requests to settle before migrating.
This is a known migration friction — documented, unavoidable given SVM constraints.

---

### 4.2 `init_treasury_config`

Admin-only. Creates `TreasuryConfig`. Sets `pool.treasury_initialized = true`.
Validates sum of `allocation_bps == 10_000`.

---

### 4.3 `deploy_to_strategy`

```
Accounts:
- admin (or any signer if admin_only_deploy = false)
- pool (mut)
- treasury_config
- yield_position (init_if_needed)
- vault (pool's AUDD vault, source)
- receipt_token_account (pool PDA's kToken account, destination)
- external protocol accounts (Kamino reserve, etc.)
- token_program
```

Steps:
1. `compute_deployable_capital(pool)` — fail if 0
2. `validate_strategy_allocation(amount, position, config, pool, index)` — fail if over cap
3. CPI to Kamino/MarginFi deposit instruction
4. `pool.treasury_deployed += amount`
5. `position.deposited_amount += amount`
6. Emit `CapitalDeployed { pool, strategy_index, amount, total_deployed }`

---

### 4.4 `recall_from_strategy`

Permissionless — anyone can call (liveness guarantee for settlement).

Steps:
1. CPI to Kamino/MarginFi withdraw instruction (burns receipt tokens, returns AUDD)
2. `compute_recall_accounting(received, position)` → `RecallResult`
3. `pool.treasury_deployed -= position.deposited_amount`
4. `pool.total_balance += result.yield_earned`
5. `pool.yield_earned_all_time += result.yield_earned`
6. `position.deposited_amount = 0` (position closed)
7. Emit `CapitalRecalled { pool, strategy_index, principal, yield_earned }`

Partial recall (withdraw only part of position):
- Harder to implement with Kamino's receipt token model
- Phase 1: full position recall only
- Phase 2 exploration: partial recall via receipt token fractional burn

---

### 4.5 `harvest_yield`

Permissionless. Does NOT move principal — only accounting update for
protocols that track yield separately (some do, some don't).

For Kamino specifically: kTokens appreciate in value continuously.
"Harvest" means: read current kToken balance, compute AUDD value,
update `pool.total_balance` with the delta since last harvest.
No actual token transfer needed for in-place accrual protocols.

```
Accounts:
- caller (any signer, pays compute)
- pool (mut)
- yield_position (mut)
- receipt_token_account (read)
```

Steps:
1. Deserialize `receipt_token_account.amount` (current kToken balance)
2. Convert to AUDD value using protocol's exchange rate
3. `yield_since_last = audd_value - position.deposited_amount`
4. If `yield_since_last > 0`:
   - `pool.total_balance += yield_since_last`
   - `pool.yield_earned_all_time += yield_since_last`
   - `position.total_yield_harvested += yield_since_last`
   - `position.last_harvest_at = clock.unix_timestamp`
5. Emit `YieldHarvested { pool, strategy_index, yield_amount }`

---

### 4.6 `emergency_recall_all`

Permissionless. Recalls from all active positions in sequence.
Used when an approved claim cannot be settled due to deployed capital.

Each recall is a separate CPI — max 4 CPIs in one transaction (one per strategy).
Compute budget: request 400k units before calling this instruction.

After all recalls, `pool.treasury_deployed` should be 0.
Frontend can then retry `release_funds`.

---

### 4.7 `rebalance_treasury`

Admin or permissionless (configurable via `admin_only_deploy`).
Uses `compute_rebalance_delta` to determine whether to deploy or recall.
If `CanDeploy`: distributes across active strategies proportional to their `allocation_bps`.
If `MustRecall`: recalls from lowest-allocation strategy first.

---

## Part 5: New Error Codes

```rust
InsufficientLiquidBalance,  // 6028 — total_balance ok, but capital is deployed
TreasuryNotInitialized,     // 6029 — init_treasury_config not called yet
StrategyNotActive,          // 6030 — strategy slot is inactive
ReserveRatioViolation,      // 6031 — deployment would breach reserve floor
PendingClaimsBlock,         // 6032 — pending claims consume available deployable capital
StrategyCapExceeded,        // 6033 — would exceed strategy's allocation_bps ceiling
AlreadyMigrated,            // 6034 — migrate_pool_v2 called on already-migrated pool
PoolHasPendingRequests,     // 6035 — migration blocked: settle all requests first
StrategySlotFull,           // 6036 — all 4 strategy slots occupied
InvalidReserveBps,          // 6037 — reserve_bps out of valid range [500, 9000]
NegativeYield,              // 6038 — receipt token balance < deposited amount
InvalidAllocationSum,       // 6039 — strategy allocation_bps don't sum to 10_000
```

---

## Part 6: Frontend Breaking Changes

---

### 6.1 `PoolData` Interface Extension

```typescript
export interface PoolData {
    // ... all existing fields ...

    // New v2 fields
    treasuryDeployed:         number;
    pendingClaimsTotal:       number;
    treasuryReserveBps:       number;
    yieldEarnedAllTime:       number;
    treasuryInitialized:      boolean;

    // Derived — computed client-side, not on-chain fields
    liquidBalance:            number;  // totalBalance - treasuryDeployed
    reserveAmount:            number;  // totalBalance * reserveBps / 10_000
    availableForRequests:     number;  // liquidBalance - reserveAmount - pendingClaimsTotal
    deployableCapital:        number;  // availableForRequests - treasuryDeployed
    capitalEfficiencyBps:     number;  // treasuryDeployed / totalBalance * 10_000
    estimatedApyBps:          number;  // client-side annualised yield estimate
}
```

All derived fields computed in `usePool.ts` after fetching raw account data.
Never stored on-chain.

---

### 6.2 `EmergencyRequest.tsx` — Available Balance Display

Current code:
```typescript
const poolBal = fromAuddBaseUnits(pool.totalBalance);
const maxReq  = Math.floor(poolBal * pool.maxRequestPct / 100);
```

Must change to:
```typescript
const available = fromAuddBaseUnits(pool.availableForRequests);
const maxReq    = Math.floor(available * pool.maxRequestPct / 100);
```

The UI must also explain why `availableForRequests` may be much less than
`totalBalance`. Add a tooltip: "Pool has X AUDD deployed earning yield.
Available for requests: Y AUDD (Z% reserve + W AUDD in pending requests)"

---

### 6.3 Two-Step Settlement Flow — `PoolDashboard.tsx`

Current `settle` function in `RequestCard`:
```typescript
const settle = async () => {
    // ... just calls release_funds ...
};
```

New flow:
```typescript
const settle = async () => {
    const recallNeeded = computeRecallNeeded(pool, request.amountRequested);

    if (recallNeeded > 0) {
        // Step 1: recall capital
        toast.loading("Recalling deployed capital...");
        await callEmergencyRecallAll(pool);
        await confirmTransaction(...);
        toast.success("Capital recalled. Settling now...");
    }

    // Step 2: release funds (was step 1 in v1)
    await callReleaseFunds(pool, request);
};
```

The `settle` button label must change: 
- Normal case: "Settle now"
- Recall needed: "Recall & Settle (2 txns)"

Users must understand they're signing two transactions.
Estimated gas costs displayed upfront.

---

### 6.4 New Treasury Dashboard Component

New component: `TreasuryPanel.tsx`

Displays:
- Capital efficiency gauge (% of capital earning yield)
- Per-strategy positions (protocol name, deposited, yield earned, APY)
- Deployable capital remaining
- Reserve requirement
- Total yield earned all time
- Buttons: Deploy, Recall, Harvest, Rebalance (admin-gated where applicable)

---

### 6.5 IDL Migration Sequence (Exact)

```
Old frontend with old IDL serves old program  ← we are here (v1)

Step 1: Build new program
    anchor build

Step 2: Deploy new program (same program ID)
    anchor upgrade --program-id Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS \
        target/deploy/auddshield.so \
        --provider.cluster devnet

    At this moment: new program is live but ALL existing pools have
    old account layout. Frontend still uses old IDL. This is safe
    because old pools are not touched until migrate_pool_v2 is called.

Step 3: Migrate each pool (admin calls migrate_pool_v2)
    For each pool where pending_requests == 0:
        call migrate_pool_v2
        call init_treasury_config

    Pools NOT yet migrated: v1 instructions still work on them
    (no treasury ops available, but join/vote/contribute/request are fine).

Step 4: Update frontend IDL
    cp target/idl/auddshield.json app/src/idl/auddshield.json
    npm run build
    npm run deploy

    At this moment: frontend can interact with both migrated (v2) and
    unmigrated (v1) pools. The PoolData interface must handle missing
    treasury fields gracefully:

    treasuryDeployed:    rawPool.treasuryDeployed?.toNumber() ?? 0,
    treasuryInitialized: rawPool.treasuryInitialized ?? false,
    // etc.

Step 5: Migrate remaining pools as their pending requests settle
    No rush — both pool versions coexist safely.

Step 6: Enable treasury operations
    Admin calls deploy_to_strategy for each migrated pool when ready.
    Capital starts earning yield.
```

---

## Part 7: What Does NOT Break

These accounts, instructions, and derivations are fully unchanged.
Zero migration work required for them.

- All existing PDA seeds (pool, vault, member, request, vote_record)
- All existing Member account layout
- All existing VoteRecord account layout
- All existing EmergencyRequest account layout
- `join_pool` instruction — no changes
- `leave_pool` instruction — no changes
- `vote` instruction — no changes
- `transfer_admin` instruction — no changes
- `set_pool_active` instruction — no changes
- `cancel_request` instruction accounts struct — only handler body changes
- All existing events remain (new events added, none removed)

---

## Part 8: Execution Checklist

```
[ ] Write math.rs with all pure functions from §3.1–3.9
[ ] Expand Pool struct + update LEN_V2 constant
[ ] Write TreasuryConfig account + LEN constant
[ ] Write YieldPosition account + LEN constant
[ ] Write StrategyAlloc struct
[ ] Write RecallResult struct
[ ] Write RebalanceDelta enum
[ ] Write migrate_pool_v2 instruction
[ ] Write init_treasury_config instruction
[ ] Write deploy_to_strategy instruction (Kamino CPI first)
[ ] Write recall_from_strategy instruction
[ ] Write harvest_yield instruction
[ ] Write emergency_recall_all instruction
[ ] Write rebalance_treasury instruction
[ ] Patch submit_request handler
[ ] Patch cancel_request handler
[ ] Patch release_funds handler
[ ] Patch update_pool_config handler + accounts struct
[ ] Add all new error codes (6028–6039)
[ ] anchor build — confirm IDL generated correctly
[ ] Update tests — add treasury instruction tests
[ ] Fix existing test: missing max_request_pct arg in createPool call
[ ] Fix existing test: admin double-join logic
[ ] Update PoolData TypeScript interface
[ ] Update EmergencyRequest.tsx available balance logic
[ ] Update PoolDashboard.tsx two-step settlement flow
[ ] Write TreasuryPanel.tsx component
[ ] Write useContribute.ts / useTreasury.ts hooks
[ ] Update usePool.ts derived field computation
[ ] Graceful fallback for unmigrated pools (optional treasury fields)
[ ] anchor test (all green)
[ ] anchor build --verifiable
[ ] anchor upgrade devnet
[ ] Run migration for all devnet pools
[ ] cp IDL to frontend
[ ] Frontend deploy
[ ] Verify capital efficiency metric live on devnet
[ ] First deploy_to_strategy call (Kamino devnet reserve)
[ ] First harvest_yield call — confirm total_balance increases
[ ] Confirm release_funds still works post-treasury
```

---

## Summary

Phase 1 transforms AUDDShield from a protocol where 100% of capital
sits idle between claims, into a protocol where 60-80% of capital
earns yield continuously — with the reserve ratio, pending claims
reservation, and per-strategy allocation caps enforced as on-chain
invariants through a dedicated mathematical layer in `math.rs`.

The critical discipline: **no raw arithmetic in instruction handlers**.
Every balance-touching operation goes through `math.rs` pure functions.
This is what makes the capital accounting correct under all edge cases —
concurrent pending requests, partial recalls, simultaneous harvest + submit.

Phase 2 (Tranching) builds directly on top of this.
The `_reserved: [u8; 32]` padding in `Pool::LEN_V2` is pre-allocated
for the tranche fields — no second realloc migration needed.
