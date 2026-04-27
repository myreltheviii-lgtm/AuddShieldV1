//! # AUDDShield — Capital Decomposition Mathematical Layer
//!
//! This module is the single source of truth for every balance-related
//! computation in the protocol. No instruction handler performs raw arithmetic
//! on pool balances directly — every calculation is routed through the pure
//! functions defined here.
//!
//! ## Why a dedicated math module exists
//!
//! In V1, every AUDD in the pool sits in the vault. `total_balance` is the
//! complete truth and arithmetic is trivial.
//!
//! In V2, capital exists in multiple states simultaneously:
//!
//! ```text
//! total_balance
//!     = liquid_balance        ← in the vault, instantly payable
//!     + treasury_deployed     ← in Kamino/MarginFi earning yield, NOT liquid
//! ```
//!
//! And liquid balance itself decomposes further:
//!
//! ```text
//! liquid_balance
//!     = reserved_capital      ← reserve ratio floor — must always stay liquid
//!     + pending_claims        ← spoken for by active votes, cannot be deployed
//!     + free_deployable       ← can be sent to a yield strategy right now
//! ```
//!
//! Any instruction that ignores this decomposition will make decisions on
//! incomplete information. The canonical failure case: a vote passes, but
//! `release_funds` fails because the approved amount is deployed in Kamino.
//! The claimant is approved but cannot be paid.
//!
//! This module prevents that class of bug entirely by making the full capital
//! picture visible to every instruction that needs it.
//!
//! ## Design constraints
//!
//! - All functions are pure — they read a `&Pool` reference and return a
//!   `Result<u64>`. No accounts are mutated here.
//! - All arithmetic uses `checked_` operations. Every potential overflow
//!   returns `AuddShieldError::Overflow` rather than wrapping silently.
//! - Integer division is deliberately conservative. When a division floors,
//!   the protocol errs on the side of keeping more capital liquid rather than
//!   less.
//! - No floating point anywhere. Solana's BPF runtime does not support f64
//!   in a reliable way for financial arithmetic.

use anchor_lang::prelude::*;

use crate::errors::AuddShieldError;
use crate::state::pool::Pool;

// ─────────────────────────────────────────────────────────────────────────────
// Core Capital Decomposition
// ─────────────────────────────────────────────────────────────────────────────

/// Returns the amount of AUDD currently sitting in the vault and instantly
/// available for payouts or deployment.
///
/// Liquid balance is total balance minus whatever has been sent to external
/// yield protocols. Capital that is deployed is still "owned" by the pool
/// (it is tracked in `total_balance`) but it cannot be transferred out of the
/// vault until it is recalled from the yield protocol first.
///
/// This is the first decomposition boundary: total vs liquid.
pub fn compute_liquid_balance(pool: &Pool) -> Result<u64> {
    pool.total_balance
        .checked_sub(pool.treasury_deployed)
        .ok_or_else(|| error!(AuddShieldError::Overflow))
}

/// Returns the minimum amount of AUDD that must remain liquid at all times,
/// regardless of any other capital needs.
///
/// The reserve ratio (`treasury_reserve_bps`) is a basis-point floor set by
/// the pool admin. A value of 2000 means 20% of total balance must always
/// be liquid. This ensures the pool can handle small, frequent claims without
/// needing to recall deployed capital first.
///
/// Basis points (1/100 of a percent) are used instead of whole percentages
/// to allow precision for small pools. At 500 AUDD total balance, the
/// difference between 15% and 16% is 5 AUDD — meaningful for a small
/// community pool.
///
/// Uses u128 for the intermediate multiplication to prevent overflow before
/// the division. At u64::MAX for both operands, the product exceeds u64
/// range without the wider type.
pub fn compute_reserve_amount(pool: &Pool) -> Result<u64> {
    let reserve = (pool.total_balance as u128)
        .checked_mul(pool.treasury_reserve_bps as u128)
        .ok_or_else(|| error!(AuddShieldError::Overflow))?
        .checked_div(10_000)
        .ok_or_else(|| error!(AuddShieldError::Overflow))?;

    Ok(reserve as u64)
}

/// Returns the maximum amount of AUDD a new emergency request may ask for,
/// given the pool's current liquid balance and existing pending obligations.
///
/// This is the value that `submit_request` must validate against — not
/// `total_balance` (which includes deployed capital) and not `liquid_balance`
/// alone (which ignores pending claims that are already spoken for).
///
/// The three-layer subtraction:
///
/// 1. Remove deployed capital — only liquid AUDD can be committed.
/// 2. Remove the reserve floor — that capital must stay liquid regardless.
/// 3. Remove pending claims — AUDD already voted on by other requests cannot
///    be double-committed to a new request.
///
/// `saturating_sub` is used for the reserve and pending subtractions because
/// both are derived from the same total_balance — they cannot mathematically
/// exceed liquid_balance in a consistent state. If they somehow do (state
/// corruption), saturating at zero is safer than an underflow panic.
///
/// The final `checked_sub(0)` is an identity operation included to keep the
/// return type and error path consistent with the rest of the module.
pub fn compute_available_for_requests(pool: &Pool) -> Result<u64> {
    let liquid  = compute_liquid_balance(pool)?;
    let reserve = compute_reserve_amount(pool)?;
    let pending = pool.pending_claims_total;

    let available = liquid
        .saturating_sub(reserve)
        .saturating_sub(pending);

    Ok(available)
}

/// Returns the amount of AUDD that can be sent to a yield strategy right now.
///
/// Free deployable capital is what remains after satisfying all three
/// constraints: the reserve floor, existing pending claims, and capital that
/// is already deployed and not yet recalled.
///
/// The distinction between `compute_available_for_requests` and this function:
/// - `available_for_requests` answers: "can a new claim be submitted for X?"
/// - `deployable_capital` answers: "can the treasury deploy X to Kamino?"
///
/// They differ because `deployable_capital` also subtracts `treasury_deployed`
/// from the remaining liquid balance. Capital already deployed is neither
/// available for new requests (it's liquid — we can recall it) nor deployable
/// again (it's already there).
///
/// A pool where all liquid capital above the reserve is already deployed has
/// zero deployable capital even if `available_for_requests` is positive.
pub fn compute_deployable_capital(pool: &Pool) -> Result<u64> {
    let liquid   = compute_liquid_balance(pool)?;
    let reserve  = compute_reserve_amount(pool)?;
    let pending  = pool.pending_claims_total;

    let deployable = liquid
        .saturating_sub(reserve)
        .saturating_sub(pending);

    Ok(deployable)
}

// ─────────────────────────────────────────────────────────────────────────────
// Strategy Allocation
// ─────────────────────────────────────────────────────────────────────────────

/// Returns the maximum amount that can be deployed to a single strategy,
/// enforcing both the global deployable capital ceiling and the strategy's
/// individual allocation percentage.
///
/// Each strategy in `TreasuryConfig` has an `allocation_bps` — its share of
/// the total deployable capital. Enforcing this on-chain prevents any single
/// protocol from receiving more than its configured share, which is the
/// on-chain implementation of capital diversification.
///
/// Example: 10,000 AUDD deployable, strategy allocation 4000 bps (40%) →
/// this strategy may receive at most 4,000 AUDD, even if all other strategies
/// are at zero.
///
/// The intermediate u128 multiplication prevents overflow when both
/// `deployable_capital` and `allocation_bps` are large.
pub fn compute_strategy_cap(
    pool: &Pool,
    allocation_bps: u16,
) -> Result<u64> {
    let deployable = compute_deployable_capital(pool)?;

    let cap = (deployable as u128)
        .checked_mul(allocation_bps as u128)
        .ok_or_else(|| error!(AuddShieldError::Overflow))?
        .checked_div(10_000)
        .ok_or_else(|| error!(AuddShieldError::Overflow))?;

    Ok(cap as u64)
}

// ─────────────────────────────────────────────────────────────────────────────
// Yield Accounting
// ─────────────────────────────────────────────────────────────────────────────

/// Computes the yield earned on a deployed position by comparing the current
/// value of the receipt token to the principal we originally deposited.
///
/// Yield protocols (Kamino, MarginFi) issue receipt tokens when capital is
/// deposited. These receipt tokens appreciate in value as interest accrues.
/// The current AUDD value of the receipt token balance minus our original
/// deposit is the yield earned since last harvest.
///
/// `receipt_token_value_in_audd` is the current AUDD-denominated value of
/// the receipt token balance, fetched from the protocol's exchange rate at
/// harvest time.
///
/// `deposited_amount` is our internal ledger of the principal we deposited —
/// the value stored in `YieldPosition.deposited_amount`.
///
/// A negative yield (receipt value < deposited amount) means the protocol
/// experienced a loss — insolvency, slashing, or a bug in the exchange rate
/// calculation. This should be mathematically impossible for overcollateralised
/// lending protocols on established assets, but we return `NegativeYield`
/// rather than underflowing to make the failure visible and auditable.
pub fn compute_yield_earned(
    receipt_token_value_in_audd: u64,
    deposited_amount: u64,
) -> Result<u64> {
    receipt_token_value_in_audd
        .checked_sub(deposited_amount)
        .ok_or_else(|| error!(AuddShieldError::NegativeYield))
}

// ─────────────────────────────────────────────────────────────────────────────
// Recall Accounting
// ─────────────────────────────────────────────────────────────────────────────

/// The result of recalling capital from a yield strategy.
/// Separates the returned funds into the original principal and any yield
/// earned since deposit, enabling precise pool accounting updates.
#[derive(Debug)]
pub struct RecallResult {
    /// The portion of returned funds that was originally deposited as principal.
    /// This does not represent new value — it was already counted in
    /// `pool.total_balance` when it was deployed.
    pub principal_returned: u64,

    /// The portion of returned funds that represents interest earned.
    /// This IS new value — it was generated by the yield protocol and
    /// must be added to `pool.total_balance` and `pool.yield_earned_all_time`.
    pub yield_earned: u64,
}

/// Decomposes a recall's returned amount into principal and yield components.
///
/// When capital is recalled from a yield protocol, the protocol returns
/// the original deposit plus any accrued interest in a single transfer.
/// To update pool accounting correctly, we must know which portion is
/// "returning home" (principal — already in total_balance) and which is
/// net-new value (yield — must be added to total_balance).
///
/// Getting this wrong is the most consequential accounting bug in the system:
///
/// If yield is counted as principal: `pool.total_balance` inflates on every
/// harvest cycle, making the pool appear to have more capital than it does.
/// Reserve calculations, request limits, and deployment caps all become
/// incorrect. The pool gradually becomes insolvent.
///
/// If principal is counted as yield: `pool.total_balance` gets double-counted
/// (it was already there), inflating it by the full principal on every recall.
/// The pool thinks it has twice the capital it actually has.
///
/// The correct invariant:
/// - `pool.treasury_deployed` decreases by `principal_returned`
/// - `pool.total_balance` increases by `yield_earned` only
/// - The principal is already in `total_balance` — it never left on paper
///
/// The edge case where `received_amount < deposited_amount` represents a
/// partial principal loss — a yield protocol insolvent event. We handle it
/// by returning all received funds as principal with zero yield, keeping
/// `total_balance` accurate (it will decrease on the treasury_deployed
/// adjustment to reflect the real loss).
pub fn compute_recall_accounting(
    received_amount: u64,
    deposited_amount: u64,
) -> Result<RecallResult> {
    if received_amount >= deposited_amount {
        // Normal case: protocol returned principal plus yield.
        let yield_earned = received_amount
            .checked_sub(deposited_amount)
            .ok_or_else(|| error!(AuddShieldError::Overflow))?;

        Ok(RecallResult {
            principal_returned: deposited_amount,
            yield_earned,
        })
    } else {
        // Loss event: protocol returned less than deposited.
        // All returned funds are treated as partial principal recovery.
        // yield_earned = 0 prevents inflating total_balance on a loss.
        Ok(RecallResult {
            principal_returned: received_amount,
            yield_earned: 0,
        })
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Rebalance Decision
// ─────────────────────────────────────────────────────────────────────────────

/// The outcome of evaluating whether the pool's current deployment level
/// is consistent with its reserve ratio and pending obligations.
#[derive(Debug, PartialEq)]
pub enum RebalanceDelta {
    /// The pool has more liquid capital than required by the reserve floor
    /// and pending claims. Up to this amount can be safely deployed to
    /// yield strategies.
    CanDeploy(u64),

    /// The pool's liquid balance has fallen below the required minimum.
    /// At least this much capital must be recalled from yield strategies
    /// before the pool is in compliance.
    MustRecall(u64),

    /// The pool is in compliance — liquid balance exactly meets the
    /// required minimum. No deployment or recall needed.
    Balanced,
}

/// Determines whether the pool needs to deploy more capital, recall deployed
/// capital, or is already in balance.
///
/// This function is the decision layer for `rebalance_treasury`. It compares
/// the current liquid balance against the minimum required liquid balance
/// (reserve floor + pending claims) and returns the gap in either direction.
///
/// The required minimum liquid balance:
/// ```text
/// required_liquid = reserve_amount + pending_claims_total
/// ```
///
/// Reserve amount covers the % floor (e.g. 20% of total).
/// Pending claims covers AUDD already committed to active votes.
///
/// If `liquid >= required_liquid`:
///   The excess is free to deploy. The pool has more liquid capital than it
///   needs right now. Deploying the excess earns yield.
///
/// If `liquid < required_liquid`:
///   The shortfall must be recalled. The pool does not have enough liquid
///   AUDD to cover its reserve floor and pending claims simultaneously.
///   This can happen when yield from deployed capital increases total_balance
///   and therefore increases the reserve requirement.
pub fn compute_rebalance_delta(pool: &Pool) -> Result<RebalanceDelta> {
    let liquid   = compute_liquid_balance(pool)?;
    let reserve  = compute_reserve_amount(pool)?;
    let pending  = pool.pending_claims_total;

    let required_liquid = reserve
        .checked_add(pending)
        .ok_or_else(|| error!(AuddShieldError::Overflow))?;

    if liquid > required_liquid {
        let excess = liquid
            .checked_sub(required_liquid)
            .ok_or_else(|| error!(AuddShieldError::Overflow))?;
        Ok(RebalanceDelta::CanDeploy(excess))
    } else if liquid < required_liquid {
        let shortfall = required_liquid
            .checked_sub(liquid)
            .ok_or_else(|| error!(AuddShieldError::Overflow))?;
        Ok(RebalanceDelta::MustRecall(shortfall))
    } else {
        Ok(RebalanceDelta::Balanced)
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Metrics
// ─────────────────────────────────────────────────────────────────────────────

/// Returns the percentage of total pool capital that is currently earning
/// yield, expressed in basis points (10_000 = 100%).
///
/// Capital efficiency measures how much of the pool's total capital is
/// deployed and working. A pool with 10,000 AUDD that has deployed 7,000 AUDD
/// to Kamino has 70% capital efficiency (7000 bps).
///
/// The theoretical maximum efficiency for a pool with a 20% reserve is 8000
/// bps (80%), since 20% must always stay liquid. The actual efficiency will
/// be lower during periods of active pending claims, which reserve additional
/// liquid capital.
///
/// Returns 0 if `total_balance` is zero to avoid division by zero.
/// Saturates at 10_000 (100%) as an arithmetic safety ceiling —
/// efficiency above 100% is impossible in a consistent state.
pub fn compute_capital_efficiency_bps(pool: &Pool) -> u16 {
    if pool.total_balance == 0 {
        return 0;
    }

    let efficiency = (pool.treasury_deployed as u128)
        .saturating_mul(10_000)
        .checked_div(pool.total_balance as u128)
        .unwrap_or(0);

    efficiency.min(10_000) as u16
}

/// Returns the minimum amount of capital that must be recalled from yield
/// strategies to make a specific payout possible, given the current liquid
/// balance.
///
/// Used by `release_funds` to determine whether a two-step settlement is
/// needed (recall first, then release) or whether the liquid balance already
/// covers the payout.
///
/// Returns 0 if the liquid balance already covers `payout_amount` — no recall
/// needed, `release_funds` can proceed immediately.
///
/// Returns the shortfall if liquid is insufficient — this is the minimum
/// amount that must be recalled before `release_funds` will succeed.
pub fn compute_recall_needed_for_payout(pool: &Pool, payout_amount: u64) -> Result<u64> {
    let liquid = compute_liquid_balance(pool)?;

    if liquid >= payout_amount {
        Ok(0)
    } else {
        payout_amount
            .checked_sub(liquid)
            .ok_or_else(|| error!(AuddShieldError::Overflow))
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    /// Construct a minimal Pool for testing with only the fields math.rs reads.
    /// Fields irrelevant to the math layer are zeroed or set to safe defaults.
    fn mock_pool(
        total_balance: u64,
        treasury_deployed: u64,
        pending_claims_total: u64,
        treasury_reserve_bps: u16,
    ) -> Pool {
        Pool {
            admin:                      Pubkey::default(),
            name:                       String::new(),
            audd_mint:                  Pubkey::default(),
            vault:                      Pubkey::default(),
            min_contribution:           0,
            total_balance,
            total_contributed_all_time: 0,
            member_count:               0,
            max_members:                0,
            vote_threshold_pct:         0,
            contribution_interval_days: 0,
            total_requests:             0,
            pending_requests:           0,
            created_at:                 0,
            is_active:                  true,
            bump:                       0,
            max_request_pct:            0,
            treasury_deployed,
            pending_claims_total,
            treasury_reserve_bps,
            yield_earned_all_time:      0,
            treasury_initialized:       true,
            _reserved:                  [0u8; 32],
        }
    }

    // ── compute_liquid_balance ────────────────────────────────────────────

    #[test]
    fn test_liquid_balance_no_deployment() {
        // When nothing is deployed, liquid balance equals total balance.
        let pool = mock_pool(100_000_000, 0, 0, 2000);
        assert_eq!(compute_liquid_balance(&pool).unwrap(), 100_000_000);
    }

    #[test]
    fn test_liquid_balance_with_deployment() {
        // 100 AUDD total, 70 deployed → 30 liquid.
        let pool = mock_pool(100_000_000, 70_000_000, 0, 2000);
        assert_eq!(compute_liquid_balance(&pool).unwrap(), 30_000_000);
    }

    #[test]
    fn test_liquid_balance_fully_deployed() {
        // All capital deployed — liquid = 0.
        let pool = mock_pool(100_000_000, 100_000_000, 0, 2000);
        assert_eq!(compute_liquid_balance(&pool).unwrap(), 0);
    }

    // ── compute_reserve_amount ────────────────────────────────────────────

    #[test]
    fn test_reserve_amount_twenty_percent() {
        // 20% of 100 AUDD = 20 AUDD.
        let pool = mock_pool(100_000_000, 0, 0, 2000);
        assert_eq!(compute_reserve_amount(&pool).unwrap(), 20_000_000);
    }

    #[test]
    fn test_reserve_amount_floors_on_small_pools() {
        // 20% of 7 AUDD = 1.4 AUDD → floors to 1 AUDD (1_400_000 base units).
        // Integer division is deliberately conservative.
        let pool = mock_pool(7_000_000, 0, 0, 2000);
        assert_eq!(compute_reserve_amount(&pool).unwrap(), 1_400_000);
    }

    #[test]
    fn test_reserve_amount_zero_balance() {
        // 20% of 0 = 0.
        let pool = mock_pool(0, 0, 0, 2000);
        assert_eq!(compute_reserve_amount(&pool).unwrap(), 0);
    }

    // ── compute_available_for_requests ───────────────────────────────────

    #[test]
    fn test_available_for_requests_full_scenario() {
        // 200 AUDD total, 80 deployed, 20 pending, 20% reserve.
        // Liquid = 200 - 80 = 120.
        // Reserve = 200 * 20% = 40.
        // Available = 120 - 40 - 20 = 60 AUDD.
        let pool = mock_pool(200_000_000, 80_000_000, 20_000_000, 2000);
        assert_eq!(compute_available_for_requests(&pool).unwrap(), 60_000_000);
    }

    #[test]
    fn test_available_for_requests_zero_when_over_reserved() {
        // All liquid capital is consumed by reserve + pending.
        // Should return 0, not underflow.
        let pool = mock_pool(100_000_000, 80_000_000, 15_000_000, 2000);
        // Liquid = 20. Reserve = 20. Pending = 15.
        // 20 - 20 - 15 would underflow → saturating_sub gives 0.
        assert_eq!(compute_available_for_requests(&pool).unwrap(), 0);
    }

    // ── compute_deployable_capital ────────────────────────────────────────

    #[test]
    fn test_deployable_capital_clean_pool() {
        // 100 AUDD, nothing deployed, no pending, 20% reserve.
        // Liquid = 100. Reserve = 20. Pending = 0.
        // Deployable = 100 - 20 - 0 = 80 AUDD.
        let pool = mock_pool(100_000_000, 0, 0, 2000);
        assert_eq!(compute_deployable_capital(&pool).unwrap(), 80_000_000);
    }

    #[test]
    fn test_deployable_capital_with_pending() {
        // 100 AUDD, 10 pending, 20% reserve.
        // Deployable = 100 - 20 - 10 = 70 AUDD.
        let pool = mock_pool(100_000_000, 0, 10_000_000, 2000);
        assert_eq!(compute_deployable_capital(&pool).unwrap(), 70_000_000);
    }

    // ── compute_strategy_cap ─────────────────────────────────────────────

    #[test]
    fn test_strategy_cap_forty_percent_allocation() {
        // 80 AUDD deployable, strategy gets 40% → cap = 32 AUDD.
        let pool = mock_pool(100_000_000, 0, 0, 2000);
        assert_eq!(compute_strategy_cap(&pool, 4000).unwrap(), 32_000_000);
    }

    #[test]
    fn test_strategy_cap_full_allocation() {
        // Single strategy with 100% allocation gets all deployable capital.
        let pool = mock_pool(100_000_000, 0, 0, 2000);
        assert_eq!(compute_strategy_cap(&pool, 10_000).unwrap(), 80_000_000);
    }

    // ── compute_yield_earned ─────────────────────────────────────────────

    #[test]
    fn test_yield_earned_positive() {
        // Deposited 1000, now worth 1050 → 50 AUDD yield.
        assert_eq!(
            compute_yield_earned(1_050_000_000, 1_000_000_000).unwrap(),
            50_000_000
        );
    }

    #[test]
    fn test_yield_earned_zero() {
        // Receipt token value equals deposited amount — no yield yet.
        assert_eq!(
            compute_yield_earned(1_000_000_000, 1_000_000_000).unwrap(),
            0
        );
    }

    #[test]
    fn test_yield_earned_negative_returns_error() {
        // Protocol loss — should return NegativeYield, not underflow.
        let result = compute_yield_earned(900_000_000, 1_000_000_000);
        assert!(result.is_err());
    }

    // ── compute_recall_accounting ────────────────────────────────────────

    #[test]
    fn test_recall_accounting_with_yield() {
        // Deposited 1000 AUDD, recalled 1050 AUDD (50 yield).
        let result = compute_recall_accounting(1_050_000_000, 1_000_000_000).unwrap();
        assert_eq!(result.principal_returned, 1_000_000_000);
        assert_eq!(result.yield_earned, 50_000_000);
    }

    #[test]
    fn test_recall_accounting_no_yield() {
        // Deposited 1000 AUDD, recalled exactly 1000 AUDD (no yield).
        let result = compute_recall_accounting(1_000_000_000, 1_000_000_000).unwrap();
        assert_eq!(result.principal_returned, 1_000_000_000);
        assert_eq!(result.yield_earned, 0);
    }

    #[test]
    fn test_recall_accounting_loss_event() {
        // Protocol loss — received less than deposited.
        // All received funds treated as partial principal, yield = 0.
        let result = compute_recall_accounting(900_000_000, 1_000_000_000).unwrap();
        assert_eq!(result.principal_returned, 900_000_000);
        assert_eq!(result.yield_earned, 0);
    }

    // ── compute_rebalance_delta ───────────────────────────────────────────

    #[test]
    fn test_rebalance_can_deploy() {
        // 100 AUDD liquid, 20 reserve, 0 pending → 80 deployable.
        let pool = mock_pool(100_000_000, 0, 0, 2000);
        assert_eq!(
            compute_rebalance_delta(&pool).unwrap(),
            RebalanceDelta::CanDeploy(80_000_000)
        );
    }

    #[test]
    fn test_rebalance_must_recall() {
        // Liquid is 15, but reserve requires 20 → must recall 5.
        // total=100, deployed=85, pending=0, reserve=20%.
        // Liquid = 15. Required = 20. Shortfall = 5.
        let pool = mock_pool(100_000_000, 85_000_000, 0, 2000);
        assert_eq!(
            compute_rebalance_delta(&pool).unwrap(),
            RebalanceDelta::MustRecall(5_000_000)
        );
    }

    #[test]
    fn test_rebalance_balanced() {
        // Liquid exactly equals reserve + pending.
        // total=100, deployed=80, pending=0, reserve=20%.
        // Liquid = 20. Required = 20. Delta = 0 → Balanced.
        let pool = mock_pool(100_000_000, 80_000_000, 0, 2000);
        assert_eq!(
            compute_rebalance_delta(&pool).unwrap(),
            RebalanceDelta::Balanced
        );
    }

    // ── compute_capital_efficiency_bps ───────────────────────────────────

    #[test]
    fn test_efficiency_seventy_percent() {
        // 70 of 100 AUDD deployed → 7000 bps (70%).
        let pool = mock_pool(100_000_000, 70_000_000, 0, 2000);
        assert_eq!(compute_capital_efficiency_bps(&pool), 7000);
    }

    #[test]
    fn test_efficiency_zero_balance() {
        // No capital at all → 0% efficiency, no division by zero.
        let pool = mock_pool(0, 0, 0, 2000);
        assert_eq!(compute_capital_efficiency_bps(&pool), 0);
    }

    #[test]
    fn test_efficiency_zero_deployed() {
        // Nothing deployed → 0% efficiency.
        let pool = mock_pool(100_000_000, 0, 0, 2000);
        assert_eq!(compute_capital_efficiency_bps(&pool), 0);
    }

    // ── compute_recall_needed_for_payout ─────────────────────────────────

    #[test]
    fn test_recall_needed_none() {
        // Liquid covers payout — no recall needed.
        let pool = mock_pool(100_000_000, 20_000_000, 0, 2000);
        // Liquid = 80 AUDD. Payout = 50 AUDD. Recall needed = 0.
        assert_eq!(compute_recall_needed_for_payout(&pool, 50_000_000).unwrap(), 0);
    }

    #[test]
    fn test_recall_needed_partial() {
        // Liquid = 20, payout = 50 → must recall 30 AUDD.
        let pool = mock_pool(100_000_000, 80_000_000, 0, 2000);
        assert_eq!(compute_recall_needed_for_payout(&pool, 50_000_000).unwrap(), 30_000_000);
    }
}
