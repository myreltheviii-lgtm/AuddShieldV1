/**
 * AUDDShield — Devnet Pool Creation Script
 *
 * Creates a single community pool on Solana devnet using the deployed
 * AUDDShield program. Logs the transaction signature for on-chain verification.
 *
 * Run: npx ts-node scripts/create_pool_devnet.ts
 */

import * as anchor from "@coral-xyz/anchor";
import { Program }  from "@coral-xyz/anchor";
import {
  Connection,
  Keypair,
  PublicKey,
  clusterApiUrl,
} from "@solana/web3.js";
import {
  createMint,
  getOrCreateAssociatedTokenAccount,
} from "@solana/spl-token";
import fs   from "fs";
import path from "path";

// ─── Config ────────────────────────────────────────────────────────────────

const PROGRAM_ID       = new PublicKey("5HQgDy3tkLkmT6JeFYem9dCiS3ye9CpHznoVtNhTsifM");
const POOL_NAME        = "AUDDShield Genesis Pool";
const MIN_CONTRIBUTION = new anchor.BN(1_000_000);   // 1 AUDD (6 decimals)
const VOTE_THRESHOLD   = 60;                          // 60% approval required
const MAX_MEMBERS      = 100;
const INTERVAL_DAYS    = 30;
const MAX_REQUEST_PCT  = 50;

// ─── Load wallet from Solana CLI default keypair ────────────────────────────

const walletPath = path.join(
  process.env.HOME || "~",
  ".config/solana/id.json"
);
const secretKey  = JSON.parse(fs.readFileSync(walletPath, "utf-8"));
const admin      = Keypair.fromSecretKey(Uint8Array.from(secretKey));

console.log("Admin wallet:", admin.publicKey.toBase58());

// ─── Setup provider ─────────────────────────────────────────────────────────

const connection = new Connection(clusterApiUrl("devnet"), "confirmed");
const wallet     = new anchor.Wallet(admin);
const provider   = new anchor.AnchorProvider(connection, wallet, {
  commitment: "confirmed",
});
anchor.setProvider(provider);

// ─── Load IDL ───────────────────────────────────────────────────────────────

const idl     = JSON.parse(
  fs.readFileSync(
    path.join(__dirname, "../target/idl/auddshield.json"),
    "utf-8"
  )
);
const program = new Program(idl, provider);

// ─── Derive PDAs ────────────────────────────────────────────────────────────

function getPoolPda(admin: PublicKey, name: string): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from("pool"),
      admin.toBuffer(),
      Buffer.from(name),
    ],
    PROGRAM_ID
  );
}

function getVaultPda(pool: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), pool.toBuffer()],
    PROGRAM_ID
  );
}

function getMemberPda(pool: PublicKey, wallet: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("member"), pool.toBuffer(), wallet.toBuffer()],
    PROGRAM_ID
  );
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  console.log("\n── AUDDShield Devnet Pool Creation ──\n");

  // Create a mock AUDD mint for devnet testing
  // On mainnet this would be: AUDDttiEpCydTm7joUMbYddm72jAWXZnCpPZtDoxqBSw
  console.log("Creating mock AUDD mint on devnet...");
  const auddMint = await createMint(
    connection,
    admin,          // payer
    admin.publicKey, // mint authority
    null,           // freeze authority
    6               // 6 decimals — matches real AUDD
  );
  console.log("Mock AUDD mint:", auddMint.toBase58());

  // Derive pool and vault PDAs
  const [poolPda]  = getPoolPda(admin.publicKey, POOL_NAME);
  const [vaultPda] = getVaultPda(poolPda);
  const [adminMemberPda] = getMemberPda(poolPda, admin.publicKey);

  console.log("Pool PDA:  ", poolPda.toBase58());
  console.log("Vault PDA: ", vaultPda.toBase58());

  // Create the pool
  console.log("\nCreating pool...");
  const tx = await program.methods
    .createPool(
      POOL_NAME,
      MIN_CONTRIBUTION,
      VOTE_THRESHOLD,
      MAX_MEMBERS,
      INTERVAL_DAYS,
      MAX_REQUEST_PCT
    )
    .accounts({
      admin:       admin.publicKey,
      auddMint,
      pool:        poolPda,
      vault:       vaultPda,
      adminMember: adminMemberPda,
    })
    .rpc();

  console.log("\n✅ Pool created successfully!");
  console.log("Transaction signature:", tx);
  console.log(
    "Solscan:",
    `https://solscan.io/tx/${tx}?cluster=devnet`
  );
  console.log(
    "Pool on-chain:",
    `https://solscan.io/account/${poolPda.toBase58()}?cluster=devnet`
  );

  // Fetch and display pool state
  const pool = await (program.account as any).pool.fetch(poolPda);
  console.log("\n── Pool State ──");
  console.log("Name:          ", pool.name);
  console.log("Admin:         ", pool.admin.toBase58());
  console.log("AUDD Mint:     ", pool.auddMint.toBase58());
  console.log("Member Count:  ", pool.memberCount);
  console.log("Total Balance: ", pool.totalBalance.toString());
  console.log("Is Active:     ", pool.isActive);
  console.log("Vote Threshold:", pool.voteThresholdPct, "%");
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
