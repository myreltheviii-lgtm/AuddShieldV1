# AUDDShield — Security Model

## Core Guarantee

AUDDShield is non-custodial. No admin, no operator, no third party can
withdraw funds from a pool under any circumstances. The only way AUDD
leaves a pool vault is through a passed community vote settled by the
`release_funds` instruction.

---

## Vault Ownership

The pool PDA is the vault authority. The vault is a standard SPL token
account owned by the pool PDA, derived from deterministic seeds:

```
["pool", admin_pubkey, pool_name]
```

Funds exit only when `release_funds` constructs a CPI signed by those
seeds. No private key holds vault authority — the program logic is the
only signer. There is no upgrade path that can change this without a
full program redeployment.

---

## Double-Vote Prevention

`VoteRecord` accounts are derived from `["vote", request, voter]`. The
account is created with an `init` constraint on the vote instruction.
Attempting to vote twice fails at account resolution — Anchor rejects
the transaction before the handler runs because the PDA already exists.
This is enforced at the constraint level, not the handler level.

---

## Self-Vote Prevention

The self-vote constraint fires before the `VoteRecord` init. This
ordering is critical — if the handler ran first, the init would create
a zombie PDA permanently occupying the voter's slot even on a rejected
self-vote. The constraint ordering prevents this.

---

## Double-Join Prevention

`Member` accounts are derived from `["member", pool, wallet]` with an
`init` constraint on `join_pool`. Calling `join_pool` twice for the
same wallet fails at account resolution for the same reason as
double-vote — the PDA already exists.

The admin's `Member` PDA is created inside `create_pool` atomically.
Calling `join_pool` for the admin afterward will always fail.

---

## Permissionless Settlement

`release_funds` can be called by any signer after the voting deadline.
Protocol liveness never depends on a single operator being online. This
prevents a scenario where an admin going offline permanently blocks
settlement of an approved claim.

---

## Threshold Locking

`effective_threshold` is computed at request submission time and stored
immutably on the `EmergencyRequest` account. Subsequent calls to
`update_pool_config` cannot retroactively lower the approval bar on a
pending request. Each request is settled under the rules that were in
effect when it was submitted.

---

## Tiered Approval Requirements

Large requests face higher approval thresholds enforced on-chain:

| Request Size | Required Approval |
|---|---|
| ≤ 10% of pool balance | `pool.vote_threshold_pct` |
| ≤ 30% of pool balance | `max(pool.vote_threshold_pct, 60%)` |
| > 30% of pool balance | `max(pool.vote_threshold_pct, 75%)` |

These tiers are computed at submission time and locked into
`effective_threshold`. The pool cannot be drained by a single request
without an overwhelming community supermajority.

---

## Vote Weight

Vote weight is computed as:

```
floor(member.total_contributed / pool.min_contribution).clamp(1, 10)
```

This makes sybil attacks impractical — creating many wallets does not
multiply vote weight without also multiplying contributions. Each wallet
must independently contribute to earn weight above 1.

---

## Integer Arithmetic

All vote math uses integer arithmetic only. There are no floating point
operations on-chain. The approval check:

```
yes_weight * 100 / total_weight >= effective_threshold
```

uses integer division which floors at the boundary. A request at
exactly the threshold rounds down and is rejected. This is deliberately
conservative.

All balance arithmetic uses `checked_` operations throughout. Overflow
returns an explicit error rather than wrapping silently.

---

## Admin Powers and Limits

The admin can:
- Pause and resume the pool (`set_pool_active`)
- Update pool configuration for future requests (`update_pool_config`)
- Transfer admin role to another member (`transfer_admin`)

The admin cannot:
- Withdraw funds from the vault
- Cancel another member's request
- Override a community vote outcome
- Change the threshold on a pending request

---

## Known Limitations

**Settled request PDAs are not closed.** `EmergencyRequest` accounts
remain on-chain after settlement. Rent is permanently allocated to
historical records. This is a deliberate tradeoff for auditability.

**No program upgrade authority is documented.** Operators deploying
this program should explicitly consider whether to retain or burn
upgrade authority depending on their trust model.

---

## Reporting

This is an open source protocol. If you identify a vulnerability, open
a GitHub issue marked `[SECURITY]` or contact the maintainer directly
before public disclosure.
