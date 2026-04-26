# 🛡️ AUDDShield — Community Emergency Pool on Solana

A trustless, on-chain community emergency fund powered by [AUDD](https://audd.io) — Australia's digital dollar stablecoin — built on Solana.

Communities (diaspora groups, churches, friend circles) pool AUDD together. When a member faces an emergency, they request funds. The community votes. Smart contract releases funds automatically if the vote passes.

---

## Stack

- **On-chain**: Rust + Anchor 0.29
- **Frontend**: Next.js 14 + TypeScript + Tailwind CSS
- **Wallet**: Solana Wallet Adapter (Phantom)
- **Token**: AUDD (SPL Token, 6 decimals)
- **Tests**: Mocha + Chai via `anchor test`

---

## Program Instructions

| Instruction | Description |
|---|---|
| `create_pool` | Admin creates a new community pool with AUDD vault |
| `join_pool` | Member joins an existing pool |
| `contribute` | Member deposits AUDD into the pool vault |
| `submit_request` | Member submits an emergency fund request |
| `vote` | Member votes yes/no on a pending request |
| `release_funds` | Anyone settles a request after voting deadline passes |
| `leave_pool` | Member leaves pool (if no pending request) |

---

## Accounts

| Account | Seeds | Description |
|---|---|---|
| `Pool` | `["pool", admin, name]` | Pool config + balance + metadata |
| `Member` | `["member", pool, wallet]` | Per-member contribution + vote history |
| `EmergencyRequest` | `["request", pool, index]` | Fund request + vote tally + status |
| `VoteRecord` | `["vote", request, voter]` | One-per-(voter, request) double-vote prevention |

---

## Setup

### Prerequisites

```bash
# Solana CLI
sh -c "$(curl -sSfL https://release.solana.com/stable/install)"

# Anchor CLI
cargo install --git https://github.com/coral-xyz/anchor avm --locked --force
avm install 0.29.0
avm use 0.29.0

# Node 18+
node --version
```

### Build & Test

```bash
# Clone and install
git clone <repo>
cd auddshield
npm install

# Build the Anchor program
anchor build

# Run tests (starts localnet automatically)
anchor test
```

### Deploy to Devnet

```bash
# Set cluster
solana config set --url devnet

# Airdrop SOL for deployment fees
solana airdrop 2

# Build
anchor build

# Deploy
anchor deploy --provider.cluster devnet

# Update program ID in:
# - Anchor.toml
# - programs/auddshield/src/lib.rs  (declare_id!)
# - app/src/utils/audd.ts           (PROGRAM_ID)
```

### Run Frontend

```bash
cd app
npm install
npm run dev
# → http://localhost:3000
```

**Note**: After `anchor build`, copy the generated IDL to the frontend:
```bash
cp target/idl/auddshield.json app/src/idl/auddshield.json
```

---

## Key Design Decisions

**Double-vote prevention**: `VoteRecord` PDAs are derived from `[voter, request]` — trying to vote twice will fail at the `init` constraint since the account already exists.

**Permissionless settlement**: `release_funds` can be called by anyone after the voting deadline. No admin required to release funds.

**Vault ownership**: The pool PDA owns the vault. Funds can only leave via `release_funds` instruction with a valid PDA signer — no rug possible.

**Vote math**: `yes_votes / total_votes >= threshold`. If zero votes cast → request expires.

---

## Grant

Built for the [SolAUDD Grant Program](https://superteam.fun/earn) — $1k-$10k AUDD for production-ready Solana apps using AUDD stablecoin.
