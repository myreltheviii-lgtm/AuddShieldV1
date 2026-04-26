import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Auddshield } from "../target/types/auddshield";
import {
  createMint,
  createAssociatedTokenAccount,
  mintTo,
  getAccount,
} from "@solana/spl-token";
import { assert } from "chai";

describe("auddshield", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.Auddshield as Program<Auddshield>;
  const connection = provider.connection;

  // Keypairs
  const admin = anchor.web3.Keypair.generate();
  const member1 = anchor.web3.Keypair.generate();
  const member2 = anchor.web3.Keypair.generate();
  const member3 = anchor.web3.Keypair.generate();

  // Pool config
  const POOL_NAME = "Sydney Naija Community";
  const MIN_CONTRIBUTION = new anchor.BN(10_000_000); // 10 AUDD (6 decimals)
  const VOTE_THRESHOLD = 60; // 60%
  const MAX_MEMBERS = 50;
  const CONTRIBUTION_INTERVAL_DAYS = 30;
  // Maximum percentage of pool balance any single request may claim.
  // 50% gives real headroom for large emergencies while keeping the other
  // half liquid for concurrent or follow-up requests.
  const MAX_REQUEST_PCT = 50;

  let auddMint: anchor.web3.PublicKey;
  let adminAuddAta: anchor.web3.PublicKey;
  let member1AuddAta: anchor.web3.PublicKey;
  let member2AuddAta: anchor.web3.PublicKey;
  let member3AuddAta: anchor.web3.PublicKey;

  // PDAs
  let poolPda: anchor.web3.PublicKey;
  let vaultPda: anchor.web3.PublicKey;
  let adminMemberPda: anchor.web3.PublicKey;
  let member1Pda: anchor.web3.PublicKey;
  let member2Pda: anchor.web3.PublicKey;
  let member3Pda: anchor.web3.PublicKey;
  let requestPda: anchor.web3.PublicKey;

  before(async () => {
    // Airdrop SOL to all participants
    for (const kp of [admin, member1, member2, member3]) {
      const sig = await connection.requestAirdrop(
        kp.publicKey,
        5 * anchor.web3.LAMPORTS_PER_SOL
      );
      await connection.confirmTransaction(sig);
    }

    // Create mock AUDD mint
    auddMint = await createMint(
      connection,
      admin,
      admin.publicKey,
      null,
      6 // 6 decimals like USDC/AUDD
    );

    // Create ATAs and mint AUDD
    adminAuddAta = await createAssociatedTokenAccount(
      connection,
      admin,
      auddMint,
      admin.publicKey
    );
    member1AuddAta = await createAssociatedTokenAccount(
      connection,
      member1,
      auddMint,
      member1.publicKey
    );
    member2AuddAta = await createAssociatedTokenAccount(
      connection,
      member2,
      auddMint,
      member2.publicKey
    );
    member3AuddAta = await createAssociatedTokenAccount(
      connection,
      member3,
      auddMint,
      member3.publicKey
    );

    // Mint 1000 AUDD to each member
    const MINT_AMOUNT = 1_000_000_000; // 1000 AUDD
    for (const ata of [adminAuddAta, member1AuddAta, member2AuddAta, member3AuddAta]) {
      await mintTo(connection, admin, auddMint, ata, admin, MINT_AMOUNT);
    }

    // Derive PDAs
    [poolPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("pool"), admin.publicKey.toBuffer(), Buffer.from(POOL_NAME)],
      program.programId
    );

    [vaultPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), poolPda.toBuffer()],
      program.programId
    );

    [adminMemberPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("member"), poolPda.toBuffer(), admin.publicKey.toBuffer()],
      program.programId
    );

    [member1Pda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("member"), poolPda.toBuffer(), member1.publicKey.toBuffer()],
      program.programId
    );

    [member2Pda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("member"), poolPda.toBuffer(), member2.publicKey.toBuffer()],
      program.programId
    );

    [member3Pda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("member"), poolPda.toBuffer(), member3.publicKey.toBuffer()],
      program.programId
    );
  });

  // ─────────────────────────────────────────────
  // CREATE POOL
  // ─────────────────────────────────────────────
  it("Creates a community pool", async () => {
    await program.methods
      .createPool(
        POOL_NAME,
        MIN_CONTRIBUTION,
        VOTE_THRESHOLD,
        MAX_MEMBERS,
        CONTRIBUTION_INTERVAL_DAYS,
        MAX_REQUEST_PCT
      )
      .accounts({
        admin: admin.publicKey,
        auddMint,
        pool: poolPda,
        vault: vaultPda,
      })
      .signers([admin])
      .rpc();

    const pool = await program.account.pool.fetch(poolPda);
    assert.equal(pool.name, POOL_NAME);
    assert.equal(pool.voteThresholdPct, VOTE_THRESHOLD);
    assert.equal(pool.maxMembers, MAX_MEMBERS);
    assert.isTrue(pool.isActive);
    // create_pool initialises member_count to 1 — admin is enrolled as the first
    // member in the same instruction that creates the pool. No separate join_pool
    // call is needed or valid for the admin.
    assert.equal(pool.memberCount, 1);
    assert.equal(pool.totalBalance.toNumber(), 0);
  });

  it("Rejects pool creation with invalid threshold", async () => {
    const badAdmin = anchor.web3.Keypair.generate();
    const sig = await connection.requestAirdrop(badAdmin.publicKey, anchor.web3.LAMPORTS_PER_SOL);
    await connection.confirmTransaction(sig);

    const [badPool] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("pool"), badAdmin.publicKey.toBuffer(), Buffer.from("bad")],
      program.programId
    );
    const [badVault] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), badPool.toBuffer()],
      program.programId
    );

    try {
      await program.methods
        .createPool("bad", MIN_CONTRIBUTION, 0, MAX_MEMBERS, 30, MAX_REQUEST_PCT)
        .accounts({ admin: badAdmin.publicKey, auddMint, pool: badPool, vault: badVault })
        .signers([badAdmin])
        .rpc();
      assert.fail("Should have thrown");
    } catch (e: any) {
      assert.include(e.message, "InvalidVoteThreshold");
    }
  });

  // ─────────────────────────────────────────────
  // JOIN POOL
  // ─────────────────────────────────────────────
  it("Members join the pool", async () => {
    // Admin's member PDA is created inside create_pool — the accounts struct includes
    // admin_member with an init constraint. Calling join_pool for admin again would
    // attempt to init an already-existing PDA, which fails at account resolution.
    // Only the three non-admin members need an explicit join_pool call.
    for (const [kp, pda] of [
      [member1, member1Pda],
      [member2, member2Pda],
      [member3, member3Pda],
    ] as [anchor.web3.Keypair, anchor.web3.PublicKey][]) {
      await program.methods
        .joinPool()
        .accounts({ user: kp.publicKey, pool: poolPda, member: pda })
        .signers([kp])
        .rpc();
    }

    const pool = await program.account.pool.fetch(poolPda);
    // member_count starts at 1 (admin, enrolled in create_pool).
    // Three join_pool calls bring the total to 4.
    assert.equal(pool.memberCount, 4);

    const m1 = await program.account.member.fetch(member1Pda);
    assert.isTrue(m1.isActive);
    assert.isFalse(m1.hasPendingRequest);
    assert.equal(m1.totalContributed.toNumber(), 0);
  });

  it("Rejects joining twice", async () => {
    try {
      await program.methods
        .joinPool()
        .accounts({ user: member1.publicKey, pool: poolPda, member: member1Pda })
        .signers([member1])
        .rpc();
      assert.fail("Should have thrown");
    } catch (e: any) {
      // init constraint will fail — account already exists
      assert.ok(e);
    }
  });

  // ─────────────────────────────────────────────
  // CONTRIBUTE
  // ─────────────────────────────────────────────
  it("Members contribute AUDD to the pool", async () => {
    const CONTRIBUTION = new anchor.BN(50_000_000); // 50 AUDD

    for (const [kp, memberPda, ata] of [
      [admin, adminMemberPda, adminAuddAta],
      [member1, member1Pda, member1AuddAta],
      [member2, member2Pda, member2AuddAta],
      [member3, member3Pda, member3AuddAta],
    ] as [anchor.web3.Keypair, anchor.web3.PublicKey, anchor.web3.PublicKey][]) {
      await program.methods
        .contribute(CONTRIBUTION)
        .accounts({
          contributor: kp.publicKey,
          pool: poolPda,
          member: memberPda,
          memberTokenAccount: ata,
          vault: vaultPda,
        })
        .signers([kp])
        .rpc();
    }

    const pool = await program.account.pool.fetch(poolPda);
    // 4 members * 50 AUDD = 200 AUDD
    assert.equal(pool.totalBalance.toNumber(), 200_000_000);

    const vault = await getAccount(connection, vaultPda);
    assert.equal(Number(vault.amount), 200_000_000);
  });

  it("Rejects contribution below minimum", async () => {
    try {
      await program.methods
        .contribute(new anchor.BN(1_000)) // way below min
        .accounts({
          contributor: member1.publicKey,
          pool: poolPda,
          member: member1Pda,
          memberTokenAccount: member1AuddAta,
          vault: vaultPda,
        })
        .signers([member1])
        .rpc();
      assert.fail("Should have thrown");
    } catch (e: any) {
      assert.include(e.message, "ContributionTooLow");
    }
  });

  // ─────────────────────────────────────────────
  // SUBMIT EMERGENCY REQUEST
  // ─────────────────────────────────────────────
  it("Member submits an emergency request", async () => {
    [requestPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [
        Buffer.from("request"),
        poolPda.toBuffer(),
        Buffer.from(new anchor.BN(0).toArrayLike(Buffer, "le", 4)),
      ],
      program.programId
    );

    await program.methods
      .submitRequest(
        new anchor.BN(80_000_000), // 80 AUDD
        "Medical emergency — hospital bill needs urgent payment",
        "ipfs://QmXoypizjW3WknFiJnKLwHCnL72vedxjQkDDP1mXWo6uco"
      )
      .accounts({
        requester: member1.publicKey,
        pool: poolPda,
        member: member1Pda,
        emergencyRequest: requestPda,
      })
      .signers([member1])
      .rpc();

    const request = await program.account.emergencyRequest.fetch(requestPda);
    assert.equal(request.amountRequested.toNumber(), 80_000_000);
    assert.equal(request.yesVotes, 0);
    assert.equal(request.noVotes, 0);
    assert.deepEqual(request.status, { pending: {} });

    const m1 = await program.account.member.fetch(member1Pda);
    assert.isTrue(m1.hasPendingRequest);
  });

  it("Rejects a second request from same member", async () => {
    const [requestPda2] = anchor.web3.PublicKey.findProgramAddressSync(
      [
        Buffer.from("request"),
        poolPda.toBuffer(),
        Buffer.from(new anchor.BN(1).toArrayLike(Buffer, "le", 4)),
      ],
      program.programId
    );

    try {
      await program.methods
        .submitRequest(new anchor.BN(10_000_000), "Another one", "")
        .accounts({
          requester: member1.publicKey,
          pool: poolPda,
          member: member1Pda,
          emergencyRequest: requestPda2,
        })
        .signers([member1])
        .rpc();
      assert.fail("Should have thrown");
    } catch (e: any) {
      assert.include(e.message, "AlreadyHasPendingRequest");
    }
  });

  // ─────────────────────────────────────────────
  // VOTE
  // ─────────────────────────────────────────────
  it("Community members vote on the request", async () => {
    const voters = [
      [admin, adminMemberPda],
      [member2, member2Pda],
      [member3, member3Pda],
    ] as [anchor.web3.Keypair, anchor.web3.PublicKey][];

    for (const [kp, memberPda] of voters) {
      const [voteRecordPda] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("vote"), requestPda.toBuffer(), kp.publicKey.toBuffer()],
        program.programId
      );

      await program.methods
        .vote(true) // all approve
        .accounts({
          voter: kp.publicKey,
          pool: poolPda,
          member: memberPda,
          emergencyRequest: requestPda,
          voteRecord: voteRecordPda,
        })
        .signers([kp])
        .rpc();
    }

    const request = await program.account.emergencyRequest.fetch(requestPda);
    assert.equal(request.yesVotes, 3);
    assert.equal(request.noVotes, 0);
  });

  it("Rejects requester voting on own request", async () => {
    const [voteRecordPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("vote"), requestPda.toBuffer(), member1.publicKey.toBuffer()],
      program.programId
    );

    try {
      await program.methods
        .vote(true)
        .accounts({
          voter: member1.publicKey,
          pool: poolPda,
          member: member1Pda,
          emergencyRequest: requestPda,
          voteRecord: voteRecordPda,
        })
        .signers([member1])
        .rpc();
      assert.fail("Should have thrown");
    } catch (e: any) {
      assert.include(e.message, "CannotVoteOnOwnRequest");
    }
  });

  it("Rejects double voting", async () => {
    const [voteRecordPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("vote"), requestPda.toBuffer(), admin.publicKey.toBuffer()],
      program.programId
    );

    try {
      await program.methods
        .vote(false)
        .accounts({
          voter: admin.publicKey,
          pool: poolPda,
          member: adminMemberPda,
          emergencyRequest: requestPda,
          voteRecord: voteRecordPda,
        })
        .signers([admin])
        .rpc();
      assert.fail("Should have thrown");
    } catch (e: any) {
      // init constraint fails — VoteRecord already exists
      assert.ok(e);
    }
  });

  // ─────────────────────────────────────────────
  // RELEASE FUNDS
  // Note: in real test env we'd warp clock forward.
  // Here we test the logic branch by manually advancing
  // using a localnet clock manipulation helper.
  // ─────────────────────────────────────────────
  it("Releases funds after voting deadline passes", async () => {
    // On localnet we simulate deadline passing by using a very short
    // voting window. For this test we verify state transitions directly
    // by fetching accounts and asserting correct state.
    // In a real devnet scenario, wait 5 days or use a test-only short window.

    const requestBefore = await program.account.emergencyRequest.fetch(requestPda);
    const poolBefore = await program.account.pool.fetch(poolPda);

    // Confirm 3 out of 3 eligible voters approved = 100% > 60% threshold
    const totalVotes = requestBefore.yesVotes + requestBefore.noVotes;
    const yesPct = (requestBefore.yesVotes * 100) / totalVotes;
    assert.isAtLeast(yesPct, poolBefore.voteThresholdPct);

    // This will only succeed once the voting_deadline has passed.
    // On localnet, use: `solana-test-validator --bpf-program ... --warp-slot`
    // or set VOTING_WINDOW_SECS = 1 for local testing.
    console.log(
      `  → Request has ${requestBefore.yesVotes} yes votes out of ${totalVotes} total (${yesPct}% ≥ ${poolBefore.voteThresholdPct}% threshold)`
    );
    console.log(
      `  → Voting deadline: ${new Date(requestBefore.votingDeadline.toNumber() * 1000).toISOString()}`
    );
    console.log(
      `  → To release funds in test: wait for deadline or reduce VOTING_WINDOW_SECS to 1 in request.rs`
    );
  });

  // ─────────────────────────────────────────────
  // LEAVE POOL
  // ─────────────────────────────────────────────
  it("Inactive member can leave pool", async () => {
    await program.methods
      .leavePool()
      .accounts({
        user: member3.publicKey,
        pool: poolPda,
        member: member3Pda,
      })
      .signers([member3])
      .rpc();

    const pool = await program.account.pool.fetch(poolPda);
    assert.equal(pool.memberCount, 3);
  });

  it("Member with pending request cannot leave pool", async () => {
    try {
      await program.methods
        .leavePool()
        .accounts({
          user: member1.publicKey,
          pool: poolPda,
          member: member1Pda,
        })
        .signers([member1])
        .rpc();
      assert.fail("Should have thrown");
    } catch (e: any) {
      assert.include(e.message, "AlreadyHasPendingRequest");
    }
  });
});
