import { PublicKey } from "@solana/web3.js";

// ── Program ID ───────────────────────────────────────────────────────────────
// Update this after `anchor deploy` — also update declare_id! in lib.rs and Anchor.toml
export const PROGRAM_ID = new PublicKey("Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS");

// ── AUDD Mint addresses ───────────────────────────────────────────────────────
// AUDD is Australia's on-chain dollar. 6 decimals (same as USDC).
// These are different addresses — always double-check before deployment.
// Each Solana cluster (devnet, mainnet-beta) has its own independent ledger,
// so a token deployed on one cluster does not exist on the other.
// Devnet: confirm the official AUDD devnet test mint with audd.digital before
//         deploying — or substitute a locally-minted mock token for CI testing:
//         `spl-token create-token --decimals 6`
// Mainnet: verified against the official address published at audd.digital/faq
export const AUDD_MINT_DEVNET  = new PublicKey("BgBijFXsYhGjFJCBqFkdBYeL4jHo1kFajfNkaxNt8os2");
export const AUDD_MINT_MAINNET = new PublicKey("AUDDttiEpCydTm7joUMbYddm72jAWXZnCpPZtDoxqBSw");

// ── Token helpers ────────────────────────────────────────────────────────────
export const AUDD_DECIMALS = 6;
const AUDD_SCALE = 10 ** AUDD_DECIMALS; // 1_000_000

/** Convert a human-readable AUDD amount to on-chain base units (integer). */
export function toAuddBaseUnits(human: number): number {
  return Math.round(human * AUDD_SCALE);
}

/** Convert on-chain base units to human-readable AUDD float. */
export function fromAuddBaseUnits(base: number | bigint): number {
  return Number(base) / AUDD_SCALE;
}

/** Format an on-chain base-unit amount as a localised AUDD string, e.g. "1,234.50 AUDD" */
export function formatAudd(base: number | bigint): string {
  const human = fromAuddBaseUnits(base);
  // en-AU locale: comma thousands separator, period decimal separator
  return `${human.toLocaleString("en-AU", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} AUDD`;
}

/** Format base units as a compact AUDD string without the symbol, e.g. "1,234.50" */
export function formatAuddPlain(base: number | bigint): string {
  return fromAuddBaseUnits(base).toLocaleString("en-AU", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}
