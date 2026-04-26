import { useState } from "react";
import { useConnection, useAnchorWallet } from "@solana/wallet-adapter-react";
import { SystemProgram } from "@solana/web3.js";
import { BN } from "@coral-xyz/anchor";
import toast from "react-hot-toast";
import { PoolData, MemberData } from "../hooks/usePool";
import { formatAudd, toAuddBaseUnits, fromAuddBaseUnits, PROGRAM_ID } from "../utils/audd";
import { getProvider, getProgram, getMemberPda, getRequestPda } from "../utils/anchor";

export default function EmergencyRequest({ pool, member, onRefetch }: {
  pool: PoolData; member: MemberData; onRefetch: () => void;
}) {
  const { connection } = useConnection();
  const wallet         = useAnchorWallet();

  const [amount,      setAmount]      = useState("");
  const [reason,      setReason]      = useState("");
  const [evidenceUri, setEvidenceUri] = useState("");
  const [loading,     setLoading]     = useState(false);

  const poolBal    = fromAuddBaseUnits(pool.totalBalance);
  const maxReq     = Math.floor(poolBal * pool.maxRequestPct / 100);
  const parsed     = parseFloat(amount) || 0;
  const overMax    = parsed > maxReq;
  const pctOfPool  = poolBal > 0 ? (parsed / poolBal) * 100 : 0;
  const tier       = pctOfPool <= 10 ? "low" : pctOfPool <= 30 ? "mid" : "high";
  const tierThresh = tier === "low" ? pool.voteThresholdPct : tier === "mid" ? Math.max(pool.voteThresholdPct, 60) : Math.max(pool.voteThresholdPct, 75);

  const tierMeta = {
    low:  { color: "var(--teal)",  bg: "rgba(0,201,167,0.06)",  border: "rgba(0,201,167,0.2)",  icon: "🟢", label: "Low-tier" },
    mid:  { color: "var(--amber)", bg: "rgba(245,166,35,0.06)", border: "rgba(245,166,35,0.2)",  icon: "🟡", label: "Mid-tier" },
    high: { color: "var(--rose)",  bg: "rgba(240,81,106,0.06)", border: "rgba(240,81,106,0.2)",  icon: "🔴", label: "High-tier" },
  }[tier];

  const submit = async () => {
    if (!wallet)         return toast.error("Connect wallet");
    if (!reason.trim())  return toast.error("Describe your emergency");
    if (parsed <= 0)     return toast.error("Enter an amount");
    if (overMax)         return toast.error(`Exceeds ${pool.maxRequestPct}% cap`);

    setLoading(true);
    const tid = toast.loading("Submitting…");
    try {
      const idl     = await import("../idl/auddshield.json");
      const provider = getProvider(connection, wallet);
      const program  = getProgram(provider, idl as any);
      const [memberPda]  = getMemberPda(pool.pubkey, wallet.publicKey, PROGRAM_ID);
      const [requestPda] = getRequestPda(pool.pubkey, pool.totalRequests, PROGRAM_ID);
      await (program.methods as any)
        .submitRequest(new BN(toAuddBaseUnits(parsed)), reason.trim(), evidenceUri.trim())
        .accounts({ requester: wallet.publicKey, pool: pool.pubkey,
          member: memberPda, emergencyRequest: requestPda, systemProgram: SystemProgram.programId })
        .rpc();
      toast.success("Request submitted — voting opens now", { id: tid, duration: 5000 });
      setAmount(""); setReason(""); setEvidenceUri("");
      onRefetch();
    } catch (e: any) {
      toast.error(e.message || "Failed", { id: tid });
    } finally { setLoading(false); }
  };

  if (member.hasPendingRequest) {
    return (
      <div className="card" style={{ borderRadius: "var(--r-xl)" }}>
        <div className="topper-rose" />
        <div className="p-8 text-center">
          <div className="w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-4"
            style={{ background: "rgba(245,166,35,0.08)", border: "1px solid rgba(245,166,35,0.2)" }}>
            <span className="text-2xl">⏳</span>
          </div>
          <p className="font-display font-bold text-t1 mb-1">Request pending vote</p>
          <p className="text-t3 text-sm max-w-xs mx-auto">
            Your request is open. You can have one active request at a time.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="card" style={{ borderRadius: "var(--r-xl)" }}>
      <div className="topper-rose" />
      <div className="p-5">

        {/* Header */}
        <div className="flex items-center gap-3 mb-5">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ background: "rgba(240,81,106,0.08)", border: "1px solid rgba(240,81,106,0.18)" }}>
            <span className="text-lg">🆘</span>
          </div>
          <div>
            <p className="font-display font-bold text-t1 text-base">Request Emergency Funds</p>
            <p className="text-xs mt-0.5" style={{ color: "var(--t3)" }}>
              Balance: <span style={{ color: "var(--gold)" }}>{formatAudd(pool.totalBalance)}</span>
              {" · "}Max: <span style={{ color: "var(--amber)" }}>{maxReq.toLocaleString("en-AU")} AUDD</span>
            </p>
          </div>
        </div>

        {/* Warning */}
        <div className="px-4 py-3 rounded-lg mb-5 text-xs leading-relaxed"
          style={{ background: "rgba(245,166,35,0.06)", border: "1px solid rgba(245,166,35,0.15)", color: "var(--amber)" }}>
          ⚠ Only genuine emergencies. Your community reviews every request.
          False claims damage trust and will be rejected.
        </div>

        <div className="space-y-4 mb-5">
          {/* Amount */}
          <div>
            <label className="label block mb-2">
              Amount (AUDD) — max {maxReq.toLocaleString("en-AU")} ({pool.maxRequestPct}% of pool)
            </label>
            <div className="relative">
              <input type="number" value={amount}
                onChange={e => setAmount(e.target.value)}
                max={maxReq} min="1" placeholder="0.00"
                className={`input pr-16 ${overMax ? "input-error" : ""}`}
              />
              <span className="absolute right-4 top-1/2 -translate-y-1/2 font-mono text-xs"
                style={{ color: "var(--t3)" }}>AUDD</span>
            </div>

            {/* Tier badge */}
            {parsed > 0 && !overMax && (
              <div className="mt-2 flex items-center gap-2 px-3 py-2 rounded-lg text-xs"
                style={{ background: tierMeta.bg, border: `1px solid ${tierMeta.border}`, color: tierMeta.color }}>
                {tierMeta.icon} {tierMeta.label} ({pctOfPool.toFixed(1)}% of pool) · requires {tierThresh}% approval
              </div>
            )}
            {overMax && (
              <p className="text-xs mt-1.5" style={{ color: "var(--rose)" }}>
                Exceeds {pool.maxRequestPct}% cap
              </p>
            )}
          </div>

          {/* Reason */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="label">Emergency Description</label>
              <span className="text-xs" style={{ color: "var(--t4)" }}>{reason.length}/200</span>
            </div>
            <textarea value={reason} onChange={e => setReason(e.target.value.slice(0, 200))}
              rows={3} placeholder="Describe your emergency clearly and honestly…"
              className="input" />
          </div>

          {/* Evidence */}
          <div>
            <label className="label block mb-2">
              Evidence Link <span style={{ color: "var(--t4)", fontWeight: 400, textTransform: "none", letterSpacing: 0 }}>(optional)</span>
            </label>
            <input type="text" value={evidenceUri}
              onChange={e => setEvidenceUri(e.target.value.slice(0, 100))}
              placeholder="https:// or ipfs://"
              className="input" />
          </div>
        </div>

        <button onClick={submit}
          disabled={loading || !reason.trim() || parsed <= 0 || overMax}
          className="btn w-full text-sm py-3 font-bold"
          style={{
            background: "linear-gradient(135deg,#C0304A,#F0516A)",
            color: "#fff",
            borderRadius: "var(--r-md)",
            boxShadow: "0 2px 16px rgba(240,81,106,0.25)",
            opacity: (loading || !reason.trim() || parsed <= 0 || overMax) ? 0.4 : 1,
          }}>
          {loading
            ? <><span className="spinner" style={{ borderTopColor:"#fff" }} />Submitting…</>
            : "Submit Emergency Request"}
        </button>
      </div>
    </div>
  );
}
