import { useState } from "react";
import { useConnection, useAnchorWallet } from "@solana/wallet-adapter-react";
import { SystemProgram } from "@solana/web3.js";
import toast from "react-hot-toast";
import { getProvider, getProgram, getMemberPda, getVoteRecordPda } from "../utils/anchor";
import { PROGRAM_ID } from "../utils/audd";
import type { PoolData, RequestData } from "./usePool";

export function useVote(pool: PoolData, request: RequestData, onSuccess: () => void) {
  const { connection } = useConnection();
  const wallet         = useAnchorWallet();
  const [loading, setLoading] = useState(false);

  const castVote = async (approve: boolean) => {
    if (!wallet) return toast.error("Wallet not connected");

    setLoading(true);
    const tid = toast.loading(approve ? "Voting to approve…" : "Voting to reject…");
    try {
      const idl      = await import("../idl/auddshield.json");
      const provider = getProvider(connection, wallet);
      const program  = getProgram(provider, idl as any);

      const [memberPda]     = getMemberPda(pool.pubkey, wallet.publicKey, PROGRAM_ID);
      const [voteRecordPda] = getVoteRecordPda(request.pubkey, wallet.publicKey, PROGRAM_ID);

      await (program.methods as any)
        .vote(approve)
        .accounts({
          voter:            wallet.publicKey,
          pool:             pool.pubkey,
          member:           memberPda,
          emergencyRequest: request.pubkey,
          voteRecord:       voteRecordPda,
          systemProgram:    SystemProgram.programId,
        })
        .rpc();

      toast.success(approve ? "✓ Voted to approve" : "✗ Voted to reject", { id: tid });
      onSuccess();
      return true;
    } catch (e: any) {
      if (e.message?.includes("already in use")) {
        toast.error("Already voted on this request", { id: tid });
      } else {
        toast.error(e.message || "Vote failed", { id: tid });
      }
      return false;
    } finally {
      setLoading(false);
    }
  };

  return { castVote, loading };
}
