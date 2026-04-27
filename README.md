# AUDDShield — Community Mutual Insurance on Solana

A trustless, on-chain mutual insurance protocol powered by [AUDD](https://audd.digital) — Australia's fully-backed digital dollar stablecoin — built on Solana.

Communities (diaspora groups, churches, trade collectives, informal savings circles) pool AUDD together as a shared emergency fund. When a member faces a genuine crisis, they submit a request. The community votes. If the vote passes, the smart contract releases funds automatically — no bank, no admin, no delay.

---

## Program ID

```
5HQgDy3tkLkmT6JeFYem9dCiS3ye9CpHznoVtNhTsifM
```

---

## Stack

- **On-chain**: Rust + Anchor 0.31.1
- **Frontend**: Next.js 14 + TypeScript + Tailwind CSS
- **Wallet**: Solana Wallet Adapter (Phantom, Solflare, Backpack)
- **Token**: AUDD (SPL Token, 6 decimals)
- **Tests**: Mocha + Chai via `anchor test`

---

## Instructions

| Instruction | Description |
|---|---|
| `create_pool` | Admin creates a community pool with AUDD vault. Admin is enrolled as the first member automatically. |
| `join_pool` | Member joins an existing active pool |
| `leave_pool` | Member exits pool and reclaims rent (blocked if pending request or if admin) |
| `contribute` | Member deposits AUDD into the vault. Tracks contribution streak and reputation. |
| `submit_request` | Member opens a 5-day community vote on an emergency fund request |
| `vote` | Member casts a weighted yes/no vote on a pending request |
| `release_funds` | Permissionless settlement after voting deadline — anyone can call |
| `cancel_request` | Requester withdraws their own request before settlement |
| `set_pool_active` | Admin circuit breaker — pause or resume the pool |
| `update_pool_config` | Admin updates pool rules (applies to future requests only) |
| `transfer_admin` | Admin promotes an existing member to admin role |

---

## Accounts

| Account | Seeds | Description |
|---|---|---|
| `Pool` | `["pool", admin, name]` | Pool config, balance, and metadata |
| `Member` | `["member", pool, wallet]` | Per-member contribution history, streak, reputation |
| `EmergencyRequest` | `["request", pool, index_le]` | Fund request with vote tally, threshold, and status |
| `VoteRecord` | `["vote", request, voter]` | One per (voter, request) pair — double-vote prevention |

---

## Security

- **Non-custodial vault**: Pool PDA is the vault authority. No admin can unilaterally withdraw. Funds only exit via `release_funds` after a passed community vote.
- **Permissionless settlement**: Anyone can call `release_funds` after the deadline. Liveness never depends on a single operator.
- **Weighted governance**: Vote weight = `floor(total_contributed / min_contribution)` clamped to `[1, 10]`. Sybil-resistant without KYC.
- **Tiered thresholds**: Requests >10% of pool require ≥60% approval. Requests >30% require ≥75%. Threshold is locked at submission time.
- **Delinquency enforcement**: Members who miss contribution intervals lose voting rights.

---

## Build

> Requires: Agave CLI (Solana), Anchor 0.31.1 via AVM, Node 18+, Yarn

### Install Agave (Solana CLI)

```bash
sh -c "$(curl -sSfL https://release.anza.xyz/stable/install)"
```

### Install Anchor

```bash
cargo install --git https://github.com/coral-xyz/anchor avm --locked --force
avm install 0.31.1
avm use 0.31.1
```

### Clone and install

```bash
git clone <repo>
cd AuddShieldV1
yarn install
```

### Build

> **Important**: Due to a known `proc-macro2` breaking change, you must set the following flag or the IDL build step will fail.

```bash
cargo update -p proc-macro2 --precise 1.0.95
RUSTFLAGS="--cfg=procmacro2_semver_exempt" anchor build
```

Verify artifacts exist after build:

```bash
ls target/deploy/   # auddshield.so + auddshield-keypair.json
ls target/idl/      # auddshield.json
```

### Copy IDL to frontend

```bash
cp target/idl/auddshield.json app/src/idl/auddshield.json
```

---

## Deploy to Devnet

```bash
# Set cluster
solana config set --url devnet

# Fund your deployer wallet — use the web faucet if CLI rate-limits you
# https://faucet.solana.com
solana airdrop 4

# Check balance
solana balance

# Deploy
RUSTFLAGS="--cfg=procmacro2_semver_exempt" anchor build
anchor deploy
```

After deploy, update the program ID in:
- `programs/auddshield/src/lib.rs` → `declare_id!(...)`
- `Anchor.toml` → `[programs.devnet]`
- `app/src/utils/anchor.ts` → `PROGRAM_ID`

---

## Run Frontend

```bash
cd app
yarn install
yarn dev
# → http://localhost:3000
```

---

## Key Design Decisions

**Admin enrolled at creation**: `create_pool` inits the admin's `Member` PDA atomically. Do not call `join_pool` for the admin — the account already exists.

**Double-vote prevention**: `VoteRecord` uses an `init` constraint. Attempting to vote twice fails at account resolution before the handler runs — no handler-level check needed.

**Self-vote prevention**: The self-vote constraint fires before the `VoteRecord` init. This ordering is intentional — if the handler ran first, the init would create a zombie PDA permanently occupying the voter's slot.

**Permissionless settlement**: `release_funds` can be called by anyone after the voting deadline. No admin required. Protocol liveness is never at risk.

**Vault ownership**: The pool PDA owns the vault. Funds can only leave via a `release_funds` CPI signed by the pool PDA seeds — no rug possible.

**Weighted vote math**: `yes_weight * 100 / total_weight >= effective_threshold`. Integer division is deliberately conservative — a request at exactly the boundary rounds down and is rejected. Zero votes → Expired (not Rejected).

**Threshold locking**: `effective_threshold` is computed and stored at submission time. Subsequent `update_pool_config` calls cannot retroactively lower the bar on a pending request.

---

## Roadmap

| Phase | Description |
|---|---|
| **V1** (current) | Core mutual insurance protocol — pools, voting, permissionless settlement |
| **V2 Phase 1** | Active treasury — idle AUDD deployed to Kamino/MarginFi earning yield between claims |
| **V2 Phase 2** | Tranche architecture — senior/junior risk tranches, elevated yield for first-loss providers |
| **V2 Phase 3** | Reinsurance layer — cross-pool risk spreading, catastrophic claim coverage |
| **V2 Phase 4** | Dynamic risk pricing — actuarial model, contribution premiums based on claim history |
| **V2 Phase 5** | Protocol governance — veAUDD, protocol-level parameter governance |

---

## Grant

Supported by the [SolAUDD Grant Program](https://superteam.fun/earn) — production-ready Solana infrastructure using AUDD as Australia's on-chain digital dollar.
