import { useState } from "react";
import { useAnchorWallet } from "@solana/wallet-adapter-react";
import { PoolData, MemberData, RequestData } from "../hooks/usePool";
import { formatAudd } from "../utils/audd";
import { useVote } from "../hooks/useVote";

export default function VotePanel({ request, pool, member, onRefetch }: {
  request: RequestData; pool: PoolData; member: MemberData | null; onRefetch: () => void;
}) {
  const wallet = useAnchorWallet();
  const { castVote, loading } = useVote(pool, request, onRefetch);
  const [voted, setVoted] = useState<boolean | null>(null);

  const totalWeight  = request.yesWeight + request.noWeight;
  const yesWeightPct = totalWeight > 0 ? Math.round((request.yesWeight / totalWeight) * 100) : 0;
  const noWeightPct  = 100 - yesWeightPct;
  const threshold    = request.effectiveThreshold;
  const passing      = yesWeightPct >= threshold && totalWeight > 0;

  const msLeft   = Math.max(0, request.votingDeadline * 1000 - Date.now());
  const daysLeft = Math.floor(msLeft / 86400000);
  const hrsLeft  = Math.floor((msLeft % 86400000) / 3600000);
  const isUrgent = daysLeft === 0 && hrsLeft < 12 && request.status === "pending";

  const isOwn   = wallet && request.requester.toString() === wallet.publicKey.toString();
  const canVote = member && !isOwn && request.status === "pending" && voted === null;

  const handleVote = async (approve: boolean) => {
    const ok = await castVote(approve);
    if (ok) setVoted(approve);
  };

  return (
    <div className="card overflow-hidden" style={{ borderRadius: "var(--r-xl)" }}>
      {/* Top accent line */}
      <div style={{
        height: 2,
        background: isUrgent
          ? "linear-gradient(90deg, var(--rose), transparent)"
          : "linear-gradient(90deg, var(--amber), transparent)",
      }} />

      <div className="p-5">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 mb-4">
          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap gap-1.5 mb-2">
              <span className="badge badge-pending">🆘 Emergency</span>
              {isOwn && <span className="badge" style={{ background:"rgba(155,114,255,0.08)", borderColor:"rgba(155,114,255,0.2)", color:"var(--violet)" }}>Your request</span>}
              {request.effectiveThreshold > pool.voteThresholdPct && (
                <span className="badge badge-pending" style={{ background:"rgba(240,81,106,0.08)", borderColor:"rgba(240,81,106,0.2)", color:"var(--rose)" }}>High-value</span>
              )}
            </div>
            <p className="text-t1 text-sm font-medium leading-snug">{request.reason}</p>
            <p className="truncate-addr mt-1">{request.requester.toString().slice(0,8)}…{request.requester.toString().slice(-6)}</p>
          </div>

          <div className="text-right flex-shrink-0">
            <p className="num-gold font-bold text-xl">{formatAudd(request.amountRequested)}</p>
            {request.status === "pending" && (
              <p className="text-xs mt-0.5" style={{ color: isUrgent ? "var(--rose)" : "var(--t3)" }}>
                {isUrgent ? "⚡ " : "⏱ "}
                {daysLeft > 0 ? `${daysLeft}d ${hrsLeft}h` : `${hrsLeft}h`} left
              </p>
            )}
          </div>
        </div>

        {/* Evidence link */}
        {request.evidenceUri && (
          <a href={request.evidenceUri} target="_blank" rel="noreferrer"
            className="inline-flex items-center gap-1.5 text-xs mb-4"
            style={{ color: "var(--gold)" }}>
            📎 View evidence →
          </a>
        )}

        {/* Vote arc bar */}
        <div className="mb-4">
          <div className="flex justify-between text-xs mb-2">
            <span style={{ color: "var(--teal)" }}>✓ {request.yesVotes} votes · {yesWeightPct}% weighted</span>
            <span style={{ color: "var(--rose)" }}>✗ {request.noVotes} votes · {noWeightPct}% weighted</span>
          </div>

          {/* Segmented bar */}
          <div className="relative h-2.5 rounded-full overflow-hidden"
            style={{ background: "var(--s1)", border: "1px solid var(--b1)" }}>
            {yesWeightPct > 0 && (
              <div className="absolute left-0 top-0 h-full rounded-l-full transition-all duration-700"
                style={{
                  width: `${yesWeightPct}%`,
                  background: passing ? "linear-gradient(90deg,#007D68,#00C9A7)" : "linear-gradient(90deg,#8A7240,#D4B86A)",
                  boxShadow: passing ? "2px 0 12px rgba(0,201,167,0.4)" : "2px 0 12px rgba(212,184,106,0.3)",
                }} />
            )}
            {noWeightPct > 0 && (
              <div className="absolute right-0 top-0 h-full rounded-r-full transition-all duration-700"
                style={{ width: `${noWeightPct}%`, background: "rgba(240,81,106,0.35)" }} />
            )}
            {/* Threshold notch */}
            <div className="absolute top-0 h-full w-0.5"
              style={{ left: `${threshold}%`, background: "rgba(255,255,255,0.4)", zIndex: 2 }} />
          </div>

          <div className="flex items-center justify-between mt-2">
            <div className="flex items-center gap-1.5">
              <span className={`w-1.5 h-1.5 rounded-full`}
                style={{ background: passing ? "var(--teal)" : "var(--t4)" }} />
              <span className="text-xs" style={{ color: "var(--t3)" }}>
                {totalWeight === 0
                  ? "No votes yet"
                  : passing
                    ? `Passing — ${yesWeightPct}% ≥ ${threshold}%`
                    : `Failing — needs ${threshold - yesWeightPct}% more`}
              </span>
            </div>
            <span className="text-xs" style={{ color: "var(--t4)" }}>
              threshold {threshold}%
            </span>
          </div>

          {request.effectiveThreshold > pool.voteThresholdPct && (
            <div className="mt-2.5 flex items-center gap-2 px-3 py-2 rounded-lg text-xs"
              style={{ background: "rgba(245,166,35,0.07)", border: "1px solid rgba(245,166,35,0.15)", color: "var(--amber)" }}>
              ⚠ High-value — elevated threshold ({threshold}% vs standard {pool.voteThresholdPct}%)
            </div>
          )}
        </div>

        {/* Vote buttons */}
        {canVote && (
          <div className="grid grid-cols-2 gap-2.5">
            <button onClick={() => handleVote(true)} disabled={loading}
              className="btn py-3 text-sm font-bold"
              style={{
                background: "rgba(0,201,167,0.08)",
                border: "1px solid rgba(0,201,167,0.25)",
                color: "var(--teal)",
                borderRadius: "var(--r-md)",
              }}>
              {loading ? <span className="spinner" style={{ borderTopColor:"var(--teal)" }} /> : "✓ Approve"}
            </button>
            <button onClick={() => handleVote(false)} disabled={loading}
              className="btn py-3 text-sm font-bold"
              style={{
                background: "rgba(240,81,106,0.07)",
                border: "1px solid rgba(240,81,106,0.22)",
                color: "var(--rose)",
                borderRadius: "var(--r-md)",
              }}>
              {loading ? <span className="spinner" style={{ borderTopColor:"var(--rose)" }} /> : "✗ Reject"}
            </button>
          </div>
        )}

        {voted !== null && (
          <div className="mt-3 text-center py-2.5 rounded-lg text-sm font-semibold"
            style={{
              background: voted ? "rgba(0,201,167,0.07)" : "rgba(240,81,106,0.07)",
              color: voted ? "var(--teal)" : "var(--rose)",
              border: `1px solid ${voted ? "rgba(0,201,167,0.2)" : "rgba(240,81,106,0.2)"}`,
            }}>
            {voted ? "✓ You voted to approve" : "✗ You voted to reject"}
          </div>
        )}

        {isOwn && (
          <p className="text-center text-xs mt-3" style={{ color: "var(--t4)" }}>
            You cannot vote on your own request
          </p>
        )}
        {!member && (
          <p className="text-center text-xs mt-3" style={{ color: "var(--t4)" }}>
            Join this pool to vote
          </p>
        )}
      </div>
    </div>
  );
}
