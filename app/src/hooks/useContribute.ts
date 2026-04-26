import { useState } from "react";
import { useConnection, useAnchorWallet } from "@solana/wallet-adapter-react";
import { BN } from "@coral-xyz/anchor";
import toast from "react-hot-toast";
import { getAssociatedTokenAddress, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { getProvider, getProgram, getMemberPda, getVaultPda } from "../utils/anchor";
import { PROGRAM_ID, toAuddBaseUnits } from "../utils/audd";
import type { PoolData } from "./usePool";

export function useContribute(pool: PoolData, onSuccess: () => void) {
  const { connection } = useConnection();
  const wallet         = useAnchorWallet();
  const [loading, setLoading] = useState(false);

  const contribute = async (humanAmount: number) => {
    if (!wallet) return toast.error("Wallet not connected");

    setLoading(true);
    const tid = toast.loading("Approving transfer…");
    try {
      const idl      = await import("../idl/auddshield.json");
      const provider = getProvider(connection, wallet);
      const program  = getProgram(provider, idl as any);

      const [memberPda] = getMemberPda(pool.pubkey, wallet.publicKey, PROGRAM_ID);
      const [vaultPda]  = getVaultPda(pool.pubkey, PROGRAM_ID);
      const memberTokenAccount = await getAssociatedTokenAddress(
        pool.auddMint,
        wallet.publicKey
      );

      const tx = await (program.methods as any)
        .contribute(new BN(toAuddBaseUnits(humanAmount)))
        .accounts({
          contributor:        wallet.publicKey,
          pool:               pool.pubkey,
          member:             memberPda,
          memberTokenAccount,
          vault:              vaultPda,
          tokenProgram:       TOKEN_PROGRAM_ID,
        })
        .rpc();

      toast.success(`${humanAmount} AUDD contributed · ${tx.slice(0, 8)}…`, { id: tid });
      onSuccess();
    } catch (e: any) {
      toast.error(e.message || "Contribution failed", { id: tid });
    } finally {
      setLoading(false);
    }
  };

  return { contribute, loading };
}
