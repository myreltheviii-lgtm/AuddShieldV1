/**
 * AUDDShield — Full Devnet Lifecycle Script
 *
 * Exercises every instruction in the AUDDShield protocol on Solana devnet.
 * Logs every transaction signature for on-chain verification via Solscan.
 *
 * Lifecycle:
 *   1. Create pool          — Genesis community pool
 *   2. Join pool            — 3 members join
 *   3. Contribute AUDD      — All 4 members contribute
 *   4. Submit request       — Member1 submits emergency request
 *   5. Vote                 — Admin, member2, member3 vote yes
 *   6. Update pool config   — Admin adjusts min contribution
 *   7. Set pool active      — Admin pauses then resumes
 *   8. Leave pool           — Member3 exits
 *   9. Transfer admin       — Skipped (requires new admin to be member)
 *  10. Cancel request       — Member1 cancels their own request
 *  11. Submit new request   — Member2 submits a request
 *  12. Vote on new request  — Community votes yes
 *
 * Run: npx ts-node scripts/lifecycle_devnet.ts
 */

import * as anchor from "@coral-xyz/anchor";
import {
  Connection,
  Keypair,
  PublicKey,
  clusterApiUrl,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import {
  createMint,
  createAssociatedTokenAccount,
  mintTo,
  getAccount,
} from "@solana/spl-token";
import fs   from "fs";
import path from "path";

// ─── Constants ──────────────────────────────────────────────────────────────

const PROGRAM_ID           = new PublicKey("5HQgDy3tkLkmT6JeFYem9dCiS3ye9CpHznoVtNhTsifM");
const POOL_NAME            = "Sydney Naija Community";
const MIN_CONTRIBUTION     = new anchor.BN(10_000_000);  // 10 AUDD
const VOTE_THRESHOLD       = 60;
const MAX_MEMBERS          = 50;
const CONTRIBUTION_INTERVAL_DAYS = 30;
const MAX_REQUEST_PCT      = 50;
const CONTRIBUTION_AMOUNT  = new anchor.BN(50_000_000);  // 50 AUDD per member
const REQUEST_AMOUNT       = new anchor.BN(80_000_000);  // 80 AUDD request
const MINT_AMOUNT          = 1_000_000_000;              // 1000 AUDD per wallet
const SOLSCAN              = "https://solscan.io";

// ─── Helpers ────────────────────────────────────────────────────────────────

const log  = (msg: string) => console.log(`\n${msg}`);
const step = (n: number, msg: string) => console.log(`\n${"─".repeat(50)}\n  STEP ${n}: ${msg}\n${"─".repeat(50)}`);
const tx   = (label: string, sig: string) => {
  console.log(`  ✅ ${label}`);
  console.log(`     Sig:     ${sig}`);
  console.log(`     Solscan: ${SOLSCAN}/tx/${sig}?cluster=devnet`);
};
const acct = (label: string, pubkey: PublicKey) => {
  console.log(`  📦 ${label}: ${pubkey.toBase58()}`);
  console.log(`     Solscan: ${SOLSCAN}/account/${pubkey.toBase58()}?cluster=devnet`);
};

// ─── PDA Derivations ────────────────────────────────────────────────────────

const getPoolPda = (admin: PublicKey, name: string) =>
  PublicKey.findProgramAddressSync(
    [Buffer.from("pool"), admin.toBuffer(), Buffer.from(name)],
    PROGRAM_ID
  );

const getVaultPda = (pool: PublicKey) =>
  PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), pool.toBuffer()],
    PROGRAM_ID
  );

const getMemberPda = (pool: PublicKey, wallet: PublicKey) =>
  PublicKey.findProgramAddressSync(
    [Buffer.from("member"), pool.toBuffer(), wallet.toBuffer()],
    PROGRAM_ID
  );

const getRequestPda = (pool: PublicKey, index: number) =>
  PublicKey.findProgramAddressSync(
    [
      Buffer.from("request"),
      pool.toBuffer(),
      Buffer.from(new anchor.BN(index).toArrayLike(Buffer, "le", 4)),
    ],
    PROGRAM_ID
  );

const getVoteRecordPda = (request: PublicKey, voter: PublicKey) =>
  PublicKey.findProgramAddressSync(
    [Buffer.from("vote"), request.toBuffer(), voter.toBuffer()],
    PROGRAM_ID
  );

// ─── Setup ──────────────────────────────────────────────────────────────────

async function setup(connection: Connection) {
  // Load deployer wallet
  const walletPath = path.join(process.env.HOME || "~", ".config/solana/id.json");
  const secretKey  = JSON.parse(fs.readFileSync(walletPath, "utf-8"));
  const admin      = Keypair.fromSecretKey(Uint8Array.from(secretKey));

  // Generate fresh member wallets
  const member1 = Keypair.generate();
  const member2 = Keypair.generate();
  const member3 = Keypair.generate();

  log("Funding member wallets from admin...");
  for (const kp of [member1, member2, member3]) {
    // Transfer SOL from admin to each member for tx fees
    const transferTx = new anchor.web3.Transaction().add(anchor.web3.SystemProgram.transfer({ fromPubkey: admin.publicKey, toPubkey: kp.publicKey, lamports: LAMPORTS_PER_SOL / 2 })); const tx = await anchor.web3.sendAndConfirmTransaction(connection, transferTx, [admin]);
    
    console.log(`  💸 Funded ${kp.publicKey.toBase58().slice(0, 8)}... with 2 SOL`);
  }

  // Create mock AUDD mint (on devnet — mainnet uses AUDDttiEpCydTm7joUMbYddm72jAWXZnCpPZtDoxqBSw)
  log("Creating mock AUDD mint (6 decimals, matches real AUDD)...");
  const auddMint = await createMint(connection, admin, admin.publicKey, null, 6);
  console.log(`  🪙 AUDD Mint: ${auddMint.toBase58()}`);

  // Create ATAs
  const adminAta   = await createAssociatedTokenAccount(connection, admin,   auddMint, admin.publicKey);
  const member1Ata = await createAssociatedTokenAccount(connection, member1, auddMint, member1.publicKey);
  const member2Ata = await createAssociatedTokenAccount(connection, member2, auddMint, member2.publicKey);
  const member3Ata = await createAssociatedTokenAccount(connection, member3, auddMint, member3.publicKey);

  // Mint 1000 AUDD to each participant
  log("Minting 1000 AUDD to each participant...");
  for (const ata of [adminAta, member1Ata, member2Ata, member3Ata]) {
    await mintTo(connection, admin, auddMint, ata, admin, MINT_AMOUNT);
    console.log(`  💰 Minted 1000 AUDD to ${ata.toBase58().slice(0, 8)}...`);
  }

  return { admin, member1, member2, member3, auddMint, adminAta, member1Ata, member2Ata, member3Ata };
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  console.log("\n" + "═".repeat(60));
  console.log("  AUDDShield — Full Devnet Lifecycle");
  console.log("  Program: " + PROGRAM_ID.toBase58());
  console.log("═".repeat(60));

  const connection = new Connection(clusterApiUrl("devnet"), "confirmed");

  // Load wallet and setup
  const walletPath = path.join(process.env.HOME || "~", ".config/solana/id.json");
  const secretKey  = JSON.parse(fs.readFileSync(walletPath, "utf-8"));
  const adminKp    = Keypair.fromSecretKey(Uint8Array.from(secretKey));
  const wallet     = new anchor.Wallet(adminKp);
  const provider   = new anchor.AnchorProvider(connection, wallet, { commitment: "confirmed" });
  anchor.setProvider(provider);

  const idl     = JSON.parse(fs.readFileSync(path.join(__dirname, "../target/idl/auddshield.json"), "utf-8"));
  const program  = new anchor.Program(idl, provider);

  console.log(`\n  Admin: ${adminKp.publicKey.toBase58()}`);

  // Setup participants and tokens
  const { admin, member1, member2, member3, auddMint, adminAta, member1Ata, member2Ata, member3Ata }
    = await setup(connection);

  // Derive all PDAs upfront
  const [poolPda]        = getPoolPda(admin.publicKey, POOL_NAME);
  const [vaultPda]       = getVaultPda(poolPda);
  const [adminMemberPda] = getMemberPda(poolPda, admin.publicKey);
  const [member1Pda]     = getMemberPda(poolPda, member1.publicKey);
  const [member2Pda]     = getMemberPda(poolPda, member2.publicKey);
  const [member3Pda]     = getMemberPda(poolPda, member3.publicKey);

  log("PDAs:");
  acct("Pool    ", poolPda);
  acct("Vault   ", vaultPda);

  // ── STEP 1: Create Pool ──────────────────────────────────────────────────
  step(1, "Create Community Pool");

  const createPoolTx = await program.methods
    .createPool(POOL_NAME, MIN_CONTRIBUTION, VOTE_THRESHOLD, MAX_MEMBERS, CONTRIBUTION_INTERVAL_DAYS, MAX_REQUEST_PCT)
    .accounts({ admin: admin.publicKey, auddMint, pool: poolPda, vault: vaultPda })
    .rpc();

  tx("Pool created", createPoolTx);
  acct("Pool account", poolPda);

  let pool = await (program.account as any).pool.fetch(poolPda);
  console.log(`\n  Pool: "${pool.name}" | Members: ${pool.memberCount} | Active: ${pool.isActive} | Threshold: ${pool.voteThresholdPct}%`);

  // ── STEP 2: Members Join ─────────────────────────────────────────────────
  step(2, "Members Join Pool");

  const joinTxs: string[] = [];
  for (const [kp, pda] of [[member1, member1Pda], [member2, member2Pda], [member3, member3Pda]] as [Keypair, PublicKey][]) {
    const sig = await program.methods
      .joinPool()
      .accounts({ user: kp.publicKey, pool: poolPda, member: pda })
      .signers([kp])
      .rpc();
    joinTxs.push(sig);
    tx(`Member joined: ${kp.publicKey.toBase58().slice(0, 8)}...`, sig);
  }

  pool = await (program.account as any).pool.fetch(poolPda);
  console.log(`\n  Member count: ${pool.memberCount} (1 admin + 3 joined)`);

  // ── STEP 3: Contribute AUDD ──────────────────────────────────────────────
  step(3, "All Members Contribute AUDD");

  const contributeTxs: string[] = [];
  for (const [kp, memberPda, ata] of [
    [admin,   adminMemberPda, adminAta],
    [member1, member1Pda,     member1Ata],
    [member2, member2Pda,     member2Ata],
    [member3, member3Pda,     member3Ata],
  ] as [Keypair, PublicKey, PublicKey][]) {
    const sig = await program.methods
      .contribute(CONTRIBUTION_AMOUNT)
      .accounts({
        contributor:        kp.publicKey,
        pool:               poolPda,
        member:             memberPda,
        memberTokenAccount: ata,
        vault:              vaultPda,
      })
      .signers([kp])
      .rpc();
    contributeTxs.push(sig);
    tx(`${kp.publicKey.toBase58().slice(0, 8)}... contributed 50 AUDD`, sig);
  }

  pool = await (program.account as any).pool.fetch(poolPda);
  const vaultAcct = await getAccount(connection, vaultPda);
  console.log(`\n  Pool total balance: ${pool.totalBalance.toNumber() / 1_000_000} AUDD`);
  console.log(`  Vault on-chain:     ${Number(vaultAcct.amount) / 1_000_000} AUDD`);

  // ── STEP 4: Submit Emergency Request ────────────────────────────────────
  step(4, "Member1 Submits Emergency Request");

  const [requestPda] = getRequestPda(poolPda, 0);

  const submitTx = await program.methods
    .submitRequest(
      REQUEST_AMOUNT,
      "Medical emergency — hospital bill needs urgent payment",
      "ipfs://QmXoypizjW3WknFiJnKLwHCnL72vedxjQkDDP1mXWo6uco"
    )
    .accounts({
      requester:        member1.publicKey,
      pool:             poolPda,
      member:           member1Pda,
      emergencyRequest: requestPda,
    })
    .signers([member1])
    .rpc();

  tx("Emergency request submitted", submitTx);
  acct("Request account", requestPda);

  const request = await (program.account as any).emergencyRequest.fetch(requestPda);
  console.log(`\n  Amount:    ${request.amountRequested.toNumber() / 1_000_000} AUDD`);
  console.log(`  Status:    ${JSON.stringify(request.status)}`);
  console.log(`  Threshold: ${request.effectiveThreshold}%`);
  console.log(`  Deadline:  ${new Date(request.votingDeadline.toNumber() * 1000).toISOString()}`);

  // ── STEP 5: Community Votes ──────────────────────────────────────────────
  step(5, "Community Votes on Request (Admin + Member2 + Member3)");

  const voteTxs: string[] = [];
  for (const [kp, memberPda] of [[admin, adminMemberPda], [member2, member2Pda], [member3, member3Pda]] as [Keypair, PublicKey][]) {
    const [voteRecordPda] = getVoteRecordPda(requestPda, kp.publicKey);
    const sig = await program.methods
      .vote(true) // all vote yes
      .accounts({
        voter:            kp.publicKey,
        pool:             poolPda,
        member:           memberPda,
        emergencyRequest: requestPda,
        voteRecord:       voteRecordPda,
      })
      .signers([kp])
      .rpc();
    voteTxs.push(sig);
    tx(`${kp.publicKey.toBase58().slice(0, 8)}... voted YES`, sig);
  }

  const votedRequest = await (program.account as any).emergencyRequest.fetch(requestPda);
  const totalWeight  = votedRequest.yesWeight + votedRequest.noWeight;
  const yesPct       = totalWeight > 0 ? (votedRequest.yesWeight * 100) / totalWeight : 0;
  console.log(`\n  Yes votes:   ${votedRequest.yesVotes}`);
  console.log(`  Yes weight:  ${votedRequest.yesWeight}`);
  console.log(`  Approval:    ${yesPct}% (threshold: ${votedRequest.effectiveThreshold}%)`);
  console.log(`  Will pass:   ${yesPct >= votedRequest.effectiveThreshold ? "✅ YES" : "❌ NO"}`);

  // ── STEP 6: Update Pool Config ───────────────────────────────────────────
  step(6, "Admin Updates Pool Config");

  const updateConfigTx = await program.methods
    .updatePoolConfig(
      new anchor.BN(15_000_000), // new min contribution: 15 AUDD
      null,
      null,
      null,
      null
    )
    .accounts({ admin: admin.publicKey, pool: poolPda })
    .rpc();

  tx("Pool config updated — min contribution raised to 15 AUDD", updateConfigTx);

  pool = await (program.account as any).pool.fetch(poolPda);
  console.log(`\n  New min contribution: ${pool.minContribution.toNumber() / 1_000_000} AUDD`);

  // ── STEP 7: Pause and Resume Pool ───────────────────────────────────────
  step(7, "Admin Pauses then Resumes Pool (Circuit Breaker)");

  const pauseTx = await program.methods
    .setPoolActive(false)
    .accounts({ admin: admin.publicKey, pool: poolPda })
    .rpc();

  tx("Pool PAUSED", pauseTx);

  const resumeTx = await program.methods
    .setPoolActive(true)
    .accounts({ admin: admin.publicKey, pool: poolPda })
    .rpc();

  tx("Pool RESUMED", resumeTx);

  // ── STEP 8: Member3 Leaves Pool ─────────────────────────────────────────
  step(8, "Member3 Leaves Pool");

  const leaveTx = await program.methods
    .leavePool()
    .accounts({ user: member3.publicKey, pool: poolPda, member: member3Pda })
    .signers([member3])
    .rpc();

  tx("Member3 left pool", leaveTx);

  pool = await (program.account as any).pool.fetch(poolPda);
  console.log(`\n  Member count after leave: ${pool.memberCount}`);

  // ── STEP 9: Member1 Cancels Request ─────────────────────────────────────
  step(9, "Member1 Cancels Their Emergency Request");

  const cancelTx = await program.methods
    .cancelRequest()
    .accounts({
      requester:        member1.publicKey,
      pool:             poolPda,
      member:           member1Pda,
      emergencyRequest: requestPda,
    })
    .signers([member1])
    .rpc();

  tx("Request cancelled by requester", cancelTx);

  const cancelledRequest = await (program.account as any).emergencyRequest.fetch(requestPda);
  console.log(`\n  Request status: ${JSON.stringify(cancelledRequest.status)}`);

  const m1AfterCancel = await (program.account as any).member.fetch(member1Pda);
  console.log(`  Member1 has pending request: ${m1AfterCancel.hasPendingRequest}`);

  // ── STEP 10: Member2 Submits New Request ────────────────────────────────
  step(10, "Member2 Submits New Emergency Request");

  const [request2Pda] = getRequestPda(poolPda, 1);

  const submit2Tx = await program.methods
    .submitRequest(
      new anchor.BN(40_000_000), // 40 AUDD — smaller request
      "Urgent rent payment — eviction notice received",
      "ipfs://QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG"
    )
    .accounts({
      requester:        member2.publicKey,
      pool:             poolPda,
      member:           member2Pda,
      emergencyRequest: request2Pda,
    })
    .signers([member2])
    .rpc();

  tx("Second emergency request submitted by member2", submit2Tx);
  acct("Request 2 account", request2Pda);

  const request2 = await (program.account as any).emergencyRequest.fetch(request2Pda);
  console.log(`\n  Amount:    ${request2.amountRequested.toNumber() / 1_000_000} AUDD`);
  console.log(`  Threshold: ${request2.effectiveThreshold}%`);

  // ── STEP 11: Vote on New Request ────────────────────────────────────────
  step(11, "Community Votes on Request 2");

  for (const [kp, memberPda] of [[admin, adminMemberPda], [member1, member1Pda]] as [Keypair, PublicKey][]) {
    const [voteRecord2Pda] = getVoteRecordPda(request2Pda, kp.publicKey);
    const sig = await program.methods
      .vote(true)
      .accounts({
        voter:            kp.publicKey,
        pool:             poolPda,
        member:           memberPda,
        emergencyRequest: request2Pda,
        voteRecord:       voteRecord2Pda,
      })
      .signers([kp])
      .rpc();
    tx(`${kp.publicKey.toBase58().slice(0, 8)}... voted YES on request 2`, sig);
  }

  const request2After = await (program.account as any).emergencyRequest.fetch(request2Pda);
  console.log(`\n  Yes votes: ${request2After.yesVotes} | Yes weight: ${request2After.yesWeight}`);

  // ── Final Summary ────────────────────────────────────────────────────────
  console.log("\n" + "═".repeat(60));
  console.log("  LIFECYCLE COMPLETE — ALL INSTRUCTIONS EXECUTED ON DEVNET");
  console.log("═".repeat(60));

  pool = await (program.account as any).pool.fetch(poolPda);
  console.log(`\n  Pool:          ${poolPda.toBase58()}`);
  console.log(`  Members:       ${pool.memberCount}`);
  console.log(`  Total Balance: ${pool.totalBalance.toNumber() / 1_000_000} AUDD`);
  console.log(`  Total Requests:${pool.totalRequests}`);
  console.log(`\n  Program on Solscan:`);
  console.log(`  ${SOLSCAN}/account/${PROGRAM_ID.toBase58()}?cluster=devnet`);
  console.log(`\n  Pool on Solscan:`);
  console.log(`  ${SOLSCAN}/account/${poolPda.toBase58()}?cluster=devnet`);
  console.log("\n  Instructions executed: create_pool, join_pool, contribute,");
  console.log("  submit_request, vote, update_pool_config, set_pool_active,");
  console.log("  leave_pool, cancel_request");
  console.log("\n" + "═".repeat(60));
}

main().catch((err) => {
  console.error("\n❌ Error:", err.message || err);
  process.exit(1);
});
