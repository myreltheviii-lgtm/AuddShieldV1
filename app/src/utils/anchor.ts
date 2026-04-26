import { AnchorProvider, Program, Idl } from "@coral-xyz/anchor";
import { Connection, PublicKey } from "@solana/web3.js";
import type { AnchorWallet } from "@solana/wallet-adapter-react";
import { PROGRAM_ID } from "./audd";

// ── Provider / Program factories ─────────────────────────────────────────────

export function getProvider(connection: Connection, wallet: AnchorWallet): AnchorProvider {
  return new AnchorProvider(connection, wallet, {
    commitment: "confirmed",
    preflightCommitment: "confirmed",
  });
}

export function getProgram(provider: AnchorProvider, idl: Idl): Program {
  return new Program(idl, PROGRAM_ID, provider);
}

// ── PDA derivation helpers ───────────────────────────────────────────────────
// All helpers return [PublicKey, bump] matching findProgramAddressSync output.

/** Pool config account: ["pool", admin, name_bytes] */
export function getPoolPda(
  admin: PublicKey,
  name: string,
  programId: PublicKey = PROGRAM_ID
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("pool"), admin.toBuffer(), Buffer.from(name)],
    programId
  );
}

/** Pool vault token account: ["vault", pool] */
export function getVaultPda(
  pool: PublicKey,
  programId: PublicKey = PROGRAM_ID
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), pool.toBuffer()],
    programId
  );
}

/** Member account: ["member", pool, wallet] */
export function getMemberPda(
  pool: PublicKey,
  wallet: PublicKey,
  programId: PublicKey = PROGRAM_ID
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("member"), pool.toBuffer(), wallet.toBuffer()],
    programId
  );
}

/** Emergency request account: ["request", pool, request_index_le32] */
export function getRequestPda(
  pool: PublicKey,
  requestIndex: number,
  programId: PublicKey = PROGRAM_ID
): [PublicKey, number] {
  const indexBuf = Buffer.alloc(4);
  indexBuf.writeUInt32LE(requestIndex, 0);
  return PublicKey.findProgramAddressSync(
    [Buffer.from("request"), pool.toBuffer(), indexBuf],
    programId
  );
}

/** Vote record account: ["vote", request, voter] */
export function getVoteRecordPda(
  request: PublicKey,
  voter: PublicKey,
  programId: PublicKey = PROGRAM_ID
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("vote"), request.toBuffer(), voter.toBuffer()],
    programId
  );
}
