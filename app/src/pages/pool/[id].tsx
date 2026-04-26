import { useRouter } from "next/router";
import Head from "next/head";
import Link from "next/link";
import { useState, useMemo } from "react";
import { useConnection, useAnchorWallet, useWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import toast from "react-hot-toast";
import { usePool } from "../../hooks/usePool";
import PoolDashboard from "../../components/PoolDashboard";
import ContributePanel from "../../components/ContributePanel";
import EmergencyRequest from "../../components/EmergencyRequest";
import VotePanel from "../../components/VotePanel";
import { getProvider, getProgram, getMemberPda } from "../../utils/anchor";
import { PROGRAM_ID } from "../../utils/audd";

export default function PoolPage() {
  const router         = useRouter();
  const { id }         = router.query;
  const { connected }  = useWallet();
  const wallet         = useAnchorWallet();
  const { connection } = useConnection();
  const [joining,      setJoining]      = useState(false);

  const poolPubkey = useMemo(() => {
    if (!id || typeof id !== "string") return null;
    try { return new PublicKey(id); } catch { return null; }
  }, [id]);

  const { pool, member, requests, loading, error, refetch } = usePool(poolPubkey);
  const pendingRequests = requests.filter(r => r.status === "pending");

  const join = async () => {
    if (!wallet || !pool) return;
    setJoining(true);
    const tid = toast.loading("Joining…");
    try {
      const idl      = await import("../../idl/auddshield.json");
      const provider = getProvider(connection, wallet);
      const program  = getProgram(provider, idl as any);
      const [memberPda] = getMemberPda(pool.pubkey, wallet.publicKey, PROGRAM_ID);
      await (program.methods as any).joinPool()
        .accounts({ user: wallet.publicKey, pool: pool.pubkey,
          member: memberPda, systemProgram: SystemProgram.programId })
        .rpc();
      toast.success(`Joined "${pool.name}"`, { id: tid });
      refetch();
    } catch (e: any) { toast.error(e.message || "Failed", { id: tid }); }
    finally { setJoining(false); }
  };

  if (!poolPubkey) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <p className="text-5xl mb-4">⚠️</p>
          <p className="font-display font-bold text-t1 text-xl mb-2">Invalid pool address</p>
          <Link href="/pools" className="text-sm" style={{ color: "var(--gold)" }}>← Back to pools</Link>
        </div>
      </div>
    );
  }

  return (
    <>
      <Head>
        <title>{pool ? `${pool.name} — AUDDShield` : "Loading — AUDDShield"}</title>
      </Head>

      <div className="min-h-screen">
        {/* Nav */}
        <nav className="nav px-6 md:px-10 py-4 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center text-sm"
              style={{ background: "linear-gradient(135deg,#C9A84C,#E6C96A)" }}>🛡</div>
            <span className="font-display font-bold text-t1">AUDDShield</span>
          </Link>
          <div className="flex items-center gap-3">
            <Link href="/pools" className="text-t3 hover:text-t1 text-sm transition-colors hidden sm:block">
              ← Pools
            </Link>
            <WalletMultiButton />
          </div>
        </nav>

        <div className="max-w-5xl mx-auto px-4 py-8">

          {/* Loading */}
          {loading && (
            <div className="space-y-4">
              {[200, 140, 100].map(h => (
                <div key={h} className="card animate-pulse" style={{ height: h, borderRadius: "var(--r-xl)" }} />
              ))}
            </div>
          )}

          {/* Error */}
          {error && !loading && (
            <div className="card p-16 text-center" style={{ borderRadius: "var(--r-xl)" }}>
              <p className="text-5xl mb-4">💔</p>
              <p className="font-display font-bold text-t1 text-xl mb-2">Failed to load pool</p>
              <p className="text-t3 text-sm mb-6">{error}</p>
              <button onClick={refetch} className="btn btn-gold text-sm px-6 py-2.5">Retry</button>
            </div>
          )}

          {/* Main layout */}
          {pool && !loading && (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">

              {/* Main — 2 cols */}
              <div className="lg:col-span-2">
                <PoolDashboard pool={pool} member={member} requests={requests} onRefetch={refetch} />
              </div>

              {/* Sidebar */}
              <div className="space-y-4">

                {/* Connect prompt */}
                {!connected && (
                  <div className="card p-6 text-center" style={{ borderRadius: "var(--r-xl)" }}>
                    <p className="text-t3 text-sm mb-4">Connect to participate</p>
                    <WalletMultiButton />
                  </div>
                )}

                {/* Join prompt */}
                {connected && !member && pool.isActive && (
                  <div className="card" style={{ borderRadius: "var(--r-xl)" }}>
                    <div className="topper-full" />
                    <div className="p-6 text-center">
                      <p className="font-display font-bold text-t1 text-lg mb-1">Join this pool</p>
                      <p className="text-t3 text-xs mb-5">
                        {pool.memberCount}/{pool.maxMembers} members ·{" "}
                        {pool.maxMembers - pool.memberCount} spots left
                      </p>
                      <button onClick={join} disabled={joining} className="btn btn-gold w-full text-sm">
                        {joining ? <><span className="spinner" />Joining…</> : "Join Pool →"}
                      </button>
                    </div>
                  </div>
                )}

                {/* Paused notice */}
                {connected && !member && !pool.isActive && (
                  <div className="card p-5 text-center" style={{ borderRadius: "var(--r-xl)" }}>
                    <p className="font-semibold text-sm mb-1" style={{ color: "var(--amber)" }}>Pool paused</p>
                    <p className="text-t3 text-xs">Not accepting new members</p>
                  </div>
                )}

                {/* Member action panels */}
                {connected && member && (
                  <>
                    <ContributePanel pool={pool} member={member} onRefetch={refetch} />

                    {!member.hasPendingRequest && pool.isActive && (
                      <EmergencyRequest pool={pool} member={member} onRefetch={refetch} />
                    )}

                    {member.hasPendingRequest && (
                      <div className="card p-5 text-center" style={{ borderRadius: "var(--r-xl)" }}>
                        <span className="badge badge-pending mx-auto mb-2">⏳ Pending</span>
                        <p className="text-t1 text-sm font-medium">Request open for votes</p>
                        <p className="text-t3 text-xs mt-1">Settles after the 5-day window</p>
                      </div>
                    )}
                  </>
                )}

                {/* Pending vote cards */}
                {member && pendingRequests.length > 0 && (
                  <div>
                    <p className="label mb-3">Needs your vote</p>
                    <div className="space-y-3">
                      {pendingRequests.map(req => (
                        <VotePanel key={req.pubkey.toString()}
                          request={req} pool={pool} member={member} onRefetch={refetch} />
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
