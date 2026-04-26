import { useState, useEffect, useRef } from "react";
import { useConnection, useAnchorWallet, useWallet } from "@solana/wallet-adapter-react";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import { BN } from "@coral-xyz/anchor";
import toast from "react-hot-toast";
import { PoolData, MemberData, RequestData } from "../hooks/usePool";
import { formatAudd, fromAuddBaseUnits, PROGRAM_ID } from "../utils/audd";
import { getProvider, getProgram, getMemberPda, getVaultPda, getRequestPda } from "../utils/anchor";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";

/* ── Animated number ─────────────────────────────────────────────────────── */
function AnimNum({ value, prefix = "", suffix = "" }: { value: number; prefix?: string; suffix?: string }) {
  const [display, setDisplay] = useState(0);
  const prev = useRef(0);
  useEffect(() => {
    const start = prev.current;
    const end   = value;
    prev.current = value;
    if (start === end) return;
    const dur = 800;
    const t0  = performance.now();
    const frame = (t: number) => {
      const p = Math.min((t - t0) / dur, 1);
      const ease = 1 - Math.pow(1 - p, 3);
      setDisplay(Math.round(start + (end - start) * ease));
      if (p < 1) requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }, [value]);
  return <span>{prefix}{display.toLocaleString("en-AU")}{suffix}</span>;
}

/* ── Radial vote ring ─────────────────────────────────────────────────────── */
function VoteRing({ yesWeight, noWeight, threshold, size = 120 }: {
  yesWeight: number; noWeight: number; threshold: number; size?: number;
}) {
  const total   = yesWeight + noWeight;
  const yesPct  = total > 0 ? (yesWeight / total) * 100 : 0;
  const R       = (size / 2) - 10;
  const circ    = 2 * Math.PI * R;
  const yesDash = (yesPct / 100) * circ;
  const noDash  = ((100 - yesPct) / 100) * circ;
  const threshX = size / 2 + R * Math.cos((threshold / 100 * 360 - 90) * Math.PI / 180);
  const threshY = size / 2 + R * Math.sin((threshold / 100 * 360 - 90) * Math.PI / 180);
  const passing = yesPct >= threshold && total > 0;

  return (
    <div className="relative" style={{ width: size, height: size, flexShrink: 0 }}>
      <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
        {/* Track */}
        <circle cx={size/2} cy={size/2} r={R} fill="none"
          stroke="rgba(255,255,255,0.05)" strokeWidth="8" />
        {/* No votes */}
        {noDash > 0 && (
          <circle cx={size/2} cy={size/2} r={R} fill="none"
            stroke="rgba(240,81,106,0.4)" strokeWidth="8"
            strokeDasharray={`${noDash} ${circ}`}
            strokeDashoffset={-yesDash}
            strokeLinecap="round"
          />
        )}
        {/* Yes votes */}
        {yesDash > 0 && (
          <circle cx={size/2} cy={size/2} r={R} fill="none"
            stroke={passing ? "#00C9A7" : "#D4B86A"} strokeWidth="8"
            strokeDasharray={`${yesDash} ${circ}`}
            strokeLinecap="round"
            style={{ filter: passing ? "drop-shadow(0 0 6px #00C9A799)" : "drop-shadow(0 0 4px #D4B86A66)" }}
          />
        )}
        {/* Threshold marker */}
        <line
          x1={size/2} y1={size/2 - R + 10}
          x2={size/2} y2={size/2 - R - 4}
          stroke="rgba(255,255,255,0.5)" strokeWidth="2"
          style={{ transformOrigin: `${size/2}px ${size/2}px`, transform: `rotate(${threshold / 100 * 360}deg)` }}
        />
      </svg>
      {/* Centre text */}
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="font-display font-extrabold text-xl" style={{ color: passing ? "var(--teal)" : "var(--gold)", letterSpacing: "-0.03em" }}>
          {Math.round(yesPct)}%
        </span>
        <span className="text-xs" style={{ color: "var(--t3)" }}>approval</span>
      </div>
    </div>
  );
}

/* ── Request card ─────────────────────────────────────────────────────────── */
function RequestCard({ request, pool, member, wallet, onRefetch }: {
  request: RequestData; pool: PoolData; member: MemberData | null;
  wallet: any; onRefetch: () => void;
}) {
  const { connection } = useConnection();
  const [settling,   setSettling]   = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [expanded,   setExpanded]   = useState(false);

  const totalWeight  = request.yesWeight + request.noWeight;
  const yesWeightPct = totalWeight > 0 ? Math.round((request.yesWeight / totalWeight) * 100) : 0;
  const deadlinePast = Date.now() / 1000 > request.votingDeadline;
  const isOwn        = wallet && request.requester.toString() === wallet.publicKey.toString();

  const msLeft   = Math.max(0, request.votingDeadline * 1000 - Date.now());
  const daysLeft = Math.floor(msLeft / 86400000);
  const hrsLeft  = Math.floor((msLeft % 86400000) / 3600000);

  const { cls: badgeCls } = {
    pending:   { cls: "badge-pending"   },
    approved:  { cls: "badge-approved"  },
    rejected:  { cls: "badge-rejected"  },
    expired:   { cls: "badge-expired"   },
    cancelled: { cls: "badge-cancelled" },
  }[request.status] ?? { cls: "badge-expired" };

  const settle = async () => {
    if (!wallet) return;
    setSettling(true);
    const tid = toast.loading("Settling…");
    try {
      const idl      = await import("../idl/auddshield.json");
      const provider = getProvider(connection, wallet);
      const program  = getProgram(provider, idl as any);
      const [requesterMember] = getMemberPda(pool.pubkey, request.requester, PROGRAM_ID);
      const [vaultPda]        = getVaultPda(pool.pubkey, PROGRAM_ID);
      const { getAssociatedTokenAddress } = await import("@solana/spl-token");
      const requesterTokenAccount = await getAssociatedTokenAddress(pool.auddMint, request.requester);
      await (program.methods as any).releaseFunds()
        .accounts({ caller: wallet.publicKey, pool: pool.pubkey, emergencyRequest: request.pubkey,
          requesterMember, vault: vaultPda, requesterTokenAccount, tokenProgram: TOKEN_PROGRAM_ID })
        .rpc();
      toast.success("Settled", { id: tid });
      onRefetch();
    } catch (e: any) { toast.error(e.message || "Failed", { id: tid }); }
    finally { setSettling(false); }
  };

  const cancel = async () => {
    if (!wallet) return;
    setCancelling(true);
    const tid = toast.loading("Cancelling…");
    try {
      const idl     = await import("../idl/auddshield.json");
      const provider = getProvider(connection, wallet);
      const program  = getProgram(provider, idl as any);
      const [memberPda] = getMemberPda(pool.pubkey, wallet.publicKey, PROGRAM_ID);
      await (program.methods as any).cancelRequest()
        .accounts({ requester: wallet.publicKey, pool: pool.pubkey,
          member: memberPda, emergencyRequest: request.pubkey })
        .rpc();
      toast.success("Cancelled", { id: tid });
      onRefetch();
    } catch (e: any) { toast.error(e.message || "Failed", { id: tid }); }
    finally { setCancelling(false); }
  };

  return (
    <div className="card" style={{ borderRadius: "var(--r-lg)" }}>
      {/* Topper by status */}
      <div className={`h-px w-full ${
        request.status === "pending"  ? "topper-gold"  :
        request.status === "approved" ? "topper-teal"  :
        request.status === "rejected" ? "topper-rose"  : "topper-violet"
      }`} />

      <div className="p-5">
        {/* Top row */}
        <div className="flex items-start gap-4 mb-4">
          <VoteRing yesWeight={request.yesWeight} noWeight={request.noWeight}
            threshold={request.effectiveThreshold} size={88} />

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-2 flex-wrap">
              <span className={`badge ${badgeCls}`}>
                {request.status === "pending" ? "⏳" : request.status === "approved" ? "✓" : request.status === "rejected" ? "✗" : "⊘"}
                {" "}{request.status}
              </span>
              {isOwn && <span className="badge" style={{ background:"rgba(155,114,255,0.08)", borderColor:"rgba(155,114,255,0.2)", color:"var(--violet)" }}>Yours</span>}
              {request.effectiveThreshold > pool.voteThresholdPct && (
                <span className="badge badge-pending">High-value</span>
              )}
            </div>
            <p className="text-t1 text-sm font-medium leading-snug mb-1.5 line-clamp-2">{request.reason}</p>
            <div className="flex items-center gap-3">
              <span className="num-gold font-bold text-base">{formatAudd(request.amountRequested)}</span>
              {request.status === "pending" && !deadlinePast && (
                <span className="text-xs" style={{ color: "var(--t3)" }}>
                  {daysLeft > 0 ? `${daysLeft}d ${hrsLeft}h` : `${hrsLeft}h`} remaining
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Vote tally */}
        <div className="flex items-center gap-4 text-xs mb-4" style={{ color: "var(--t3)" }}>
          <span style={{ color: "var(--teal)" }}>{request.yesVotes} approved</span>
          <span>·</span>
          <span style={{ color: "var(--rose)" }}>{request.noVotes} rejected</span>
          <span>·</span>
          <span>needs {request.effectiveThreshold}%</span>
        </div>

        {/* Actions */}
        <div className="flex gap-2">
          {request.evidenceUri && (
            <a href={request.evidenceUri} target="_blank" rel="noreferrer"
              className="btn btn-ghost text-xs px-3 py-2">
              📎 Evidence
            </a>
          )}
          {request.status === "pending" && deadlinePast && (
            <button onClick={settle} disabled={settling}
              className="btn btn-teal text-xs px-4 py-2">
              {settling ? <><span className="spinner" />Settling…</> : "Settle now"}
            </button>
          )}
          {request.status === "pending" && !deadlinePast && isOwn && (
            <button onClick={cancel} disabled={cancelling}
              className="btn btn-rose text-xs px-4 py-2">
              {cancelling ? <><span className="spinner" />…</> : "Cancel request"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── Admin panel ──────────────────────────────────────────────────────────── */
function AdminPanel({ pool, onRefetch }: { pool: PoolData; onRefetch: () => void }) {
  const { connection } = useConnection();
  const wallet         = useAnchorWallet();

  const [threshold,    setThreshold]    = useState(pool.voteThresholdPct.toString());
  const [minContrib,   setMinContrib]   = useState(fromAuddBaseUnits(pool.minContribution).toString());
  const [maxReqPct,    setMaxReqPct]    = useState(pool.maxRequestPct.toString());
  const [intervalDays, setIntervalDays] = useState(pool.contributionIntervalDays.toString());
  const [newAdmin,     setNewAdmin]     = useState("");
  const [loading,      setLoading]      = useState<string | null>(null);

  const exec = async (key: string, fn: () => Promise<void>) => {
    setLoading(key);
    try { await fn(); } finally { setLoading(null); }
  };

  const updateConfig = () => exec("config", async () => {
    if (!wallet) return;
    const tid = toast.loading("Saving…");
    try {
      const idl      = await import("../idl/auddshield.json");
      const { toAuddBaseUnits } = await import("../utils/audd");
      const provider = getProvider(connection, wallet);
      const program  = getProgram(provider, idl as any);
      await (program.methods as any)
        .updatePoolConfig(new BN(toAuddBaseUnits(parseFloat(minContrib))),
          parseInt(threshold), null, parseInt(intervalDays), parseInt(maxReqPct))
        .accounts({ admin: wallet.publicKey, pool: pool.pubkey }).rpc();
      toast.success("Config saved", { id: tid });
      onRefetch();
    } catch (e: any) { toast.error(e.message || "Failed", { id: tid }); }
  });

  const toggleActive = () => exec("active", async () => {
    if (!wallet) return;
    const next = !pool.isActive;
    const tid  = toast.loading(next ? "Activating…" : "Pausing…");
    try {
      const idl      = await import("../idl/auddshield.json");
      const provider = getProvider(connection, wallet);
      const program  = getProgram(provider, idl as any);
      await (program.methods as any).setPoolActive(next)
        .accounts({ admin: wallet.publicKey, pool: pool.pubkey }).rpc();
      toast.success(next ? "Pool activated" : "Pool paused", { id: tid });
      onRefetch();
    } catch (e: any) { toast.error(e.message || "Failed", { id: tid }); }
  });

  const transferAdmin = () => exec("admin", async () => {
    if (!wallet || !newAdmin.trim()) return;
    const tid = toast.loading("Transferring…");
    try {
      const idl      = await import("../idl/auddshield.json");
      const provider = getProvider(connection, wallet);
      const program  = getProgram(provider, idl as any);
      const newKey   = new PublicKey(newAdmin.trim());
      const [newAdminMember] = getMemberPda(pool.pubkey, newKey, PROGRAM_ID);
      await (program.methods as any).transferAdmin()
        .accounts({ admin: wallet.publicKey, pool: pool.pubkey, newAdminMember, newAdmin: newKey })
        .rpc();
      toast.success("Admin transferred", { id: tid });
      setNewAdmin("");
      onRefetch();
    } catch (e: any) { toast.error(e.message || "Failed", { id: tid }); }
  });

  const fields = [
    { label: "Min Contribution (AUDD)", val: minContrib,   set: setMinContrib   },
    { label: "Vote Threshold (%)",      val: threshold,    set: setThreshold    },
    { label: "Request Cap (% of pool)", val: maxReqPct,    set: setMaxReqPct    },
    { label: "Contrib Interval (days)", val: intervalDays, set: setIntervalDays },
  ];

  return (
    <div className="card" style={{ marginTop: 24 }}>
      <div className="topper-violet" />
      <div className="p-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <p className="font-display font-bold text-t1 text-lg">Admin Controls</p>
            <p className="text-t3 text-xs mt-0.5">Only visible to pool admin</p>
          </div>
          <button onClick={toggleActive} disabled={loading === "active"}
            className={`btn text-xs px-4 py-2 ${pool.isActive ? "btn-rose" : "btn-teal"}`}>
            {loading === "active" ? <span className="spinner" /> : pool.isActive ? "Pause Pool" : "Activate Pool"}
          </button>
        </div>

        <div className="grid grid-cols-2 gap-3 mb-4">
          {fields.map(({ label, val, set }) => (
            <div key={label}>
              <label className="label block mb-1.5">{label}</label>
              <input type="number" value={val} onChange={(e) => set(e.target.value)} className="input" />
            </div>
          ))}
        </div>
        <button onClick={updateConfig} disabled={loading === "config"} className="btn btn-gold w-full text-sm mb-6">
          {loading === "config" ? <><span className="spinner" />Saving…</> : "Save Config"}
        </button>

        <div style={{ borderTop: "1px solid var(--b1)", paddingTop: 20 }}>
          <p className="font-semibold text-t1 text-sm mb-1">Transfer Admin Role</p>
          <p className="text-t3 text-xs mb-3">Recipient must already be a pool member.</p>
          <div className="flex gap-2">
            <input type="text" value={newAdmin} onChange={(e) => setNewAdmin(e.target.value)}
              placeholder="New admin wallet address" className="input flex-1 font-mono text-xs" />
            <button onClick={transferAdmin} disabled={loading === "admin" || !newAdmin.trim()}
              className="btn btn-rose text-xs px-4">
              {loading === "admin" ? <span className="spinner" /> : "Transfer"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Main ─────────────────────────────────────────────────────────────────── */
export default function PoolDashboard({ pool, member, requests, onRefetch }: {
  pool: PoolData; member: MemberData | null; requests: RequestData[]; onRefetch: () => void;
}) {
  const wallet    = useAnchorWallet();
  const [tab, setTab] = useState<"overview" | "requests">("overview");

  const isAdmin    = wallet && pool.admin.toString() === wallet.publicKey.toString();
  const poolBal    = fromAuddBaseUnits(pool.totalBalance);
  const allTime    = fromAuddBaseUnits(pool.totalContributedAllTime);
  const maxReq     = Math.floor(poolBal * pool.maxRequestPct / 100);
  const pendingReqs = requests.filter(r => r.status === "pending");
  const closedReqs  = requests.filter(r => r.status !== "pending");
  const fillPct     = (pool.memberCount / pool.maxMembers) * 100;

  return (
    <div className="anim-1">
      {/* ── Pool hero ────────────────────────────────────────────────── */}
      <div className="card mb-6" style={{ background: "linear-gradient(160deg, var(--s2) 0%, var(--s1) 100%)" }}>
        <div className="topper-full" />
        <div className="p-6 md:p-8">
          <div className="flex items-start justify-between gap-4 mb-8">
            <div>
              <div className="flex items-center gap-3 mb-2">
                <h1 className="font-display font-extrabold text-t1 text-2xl md:text-3xl"
                  style={{ letterSpacing: "-0.03em" }}>{pool.name}</h1>
                <span className={`badge ${pool.isActive ? "badge-active" : "badge-paused"}`}>
                  <span className={`pulse-dot ${pool.isActive ? "" : "pulse-dot-rose"}`} style={{ width:5, height:5 }} />
                  {pool.isActive ? "Active" : "Paused"}
                </span>
              </div>
              <p className="truncate-addr">{pool.pubkey.toString().slice(0,18)}…{pool.pubkey.toString().slice(-8)}</p>
            </div>
            {member && (
              <div className="text-right">
                <p className="label mb-1">Reputation</p>
                <p className="font-display font-extrabold text-3xl text-violet-DEFAULT"
                  style={{ letterSpacing: "-0.04em" }}>{member.reputationScore}</p>
                <p className="text-xs mt-0.5" style={{ color: "var(--t3)" }}>
                  streak <span style={{ color: "var(--gold)" }}>{member.contributionStreak}🔥</span>
                </p>
              </div>
            )}
          </div>

          {/* Stat grid */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
            {[
              { label: "Vault Balance",    val: <AnimNum value={Math.round(poolBal)} suffix=" AUDD" />, col: "var(--gold)"   },
              { label: "Members",          val: `${pool.memberCount} / ${pool.maxMembers}`,              col: "var(--t1)"    },
              { label: "Pending Requests", val: pool.pendingRequests.toString(),                         col: "var(--amber)" },
              { label: "Max Request",      val: `${Math.round(maxReq).toLocaleString("en-AU")} AUDD`,   col: "var(--violet)"},
            ].map(({ label, val, col }) => (
              <div key={label} className="card-inner p-4">
                <p className="label mb-1.5">{label}</p>
                <p className="font-display font-bold text-xl" style={{ color: col, letterSpacing: "-0.02em" }}>{val}</p>
              </div>
            ))}
          </div>

          {/* Member fill bar */}
          <div>
            <div className="flex justify-between mb-2">
              <span className="label">Pool capacity</span>
              <span className="text-xs" style={{ color: "var(--t3)" }}>{fillPct.toFixed(0)}% full</span>
            </div>
            <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "var(--b2)" }}>
              <div className="h-full rounded-full transition-all duration-1000"
                style={{ width: `${fillPct}%`, background: "linear-gradient(90deg, var(--gold), var(--teal))" }} />
            </div>
          </div>
        </div>
      </div>

      {/* ── Tabs ─────────────────────────────────────────────────────── */}
      <div className="flex gap-1 mb-6 p-1 rounded-xl"
        style={{ background: "var(--s2)", border: "1px solid var(--b2)" }}>
        {[
          { id: "overview",  label: "Overview" },
          { id: "requests",  label: `Requests ${pendingReqs.length > 0 ? `(${pendingReqs.length})` : ""}` },
        ].map(({ id, label }) => (
          <button key={id} onClick={() => setTab(id as any)}
            className="flex-1 py-2.5 text-sm font-semibold rounded-lg transition-all"
            style={{
              background: tab === id ? "var(--s4)" : "transparent",
              color:      tab === id ? "var(--t1)" : "var(--t3)",
              boxShadow:  tab === id ? "0 1px 4px rgba(0,0,0,0.3)" : "none",
            }}>
            {label}
          </button>
        ))}
      </div>

      {/* ── Tab: Overview ────────────────────────────────────────────── */}
      {tab === "overview" && (
        <div className="space-y-4">
          <div className="card p-6">
            <p className="font-display font-bold text-t1 mb-5">Pool Configuration</p>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-5">
              {[
                { label: "Vote threshold",     val: `${pool.voteThresholdPct}%`          },
                { label: "Min contribution",   val: formatAudd(pool.minContribution)      },
                { label: "Request cap",        val: `${pool.maxRequestPct}% of balance`  },
                { label: "Contrib interval",   val: pool.contributionIntervalDays > 0 ? `${pool.contributionIntervalDays} days` : "None" },
                { label: "All-time deposited", val: formatAudd(pool.totalContributedAllTime) },
                { label: "Total requests",     val: pool.totalRequests.toString()         },
              ].map(({ label, val }) => (
                <div key={label}>
                  <p className="label mb-1">{label}</p>
                  <p className="font-semibold text-t1 text-sm">{val}</p>
                </div>
              ))}
            </div>
          </div>

          {member && (
            <div className="card p-6">
              <p className="font-display font-bold text-t1 mb-5">My Membership</p>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-5">
                {[
                  { label: "Total contributed", val: formatAudd(member.totalContributed), col: "var(--gold)" },
                  { label: "Votes cast",        val: member.votesCast.toString(),          col: "var(--t1)"  },
                  { label: "Streak",            val: member.contributionStreak > 0 ? `${member.contributionStreak}🔥` : "—", col: "var(--teal)" },
                  { label: "Reputation",        val: member.reputationScore.toString(),    col: "var(--violet)" },
                ].map(({ label, val, col }) => (
                  <div key={label} className="card-inner p-4">
                    <p className="label mb-1">{label}</p>
                    <p className="font-display font-bold text-lg" style={{ color: col }}>{val}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {isAdmin && <AdminPanel pool={pool} onRefetch={onRefetch} />}
        </div>
      )}

      {/* ── Tab: Requests ────────────────────────────────────────────── */}
      {tab === "requests" && (
        <div className="space-y-4">
          {requests.length === 0 && (
            <div className="card p-16 text-center">
              <p className="text-4xl mb-3">🕊</p>
              <p className="font-display font-bold text-t1 text-xl mb-1">No requests</p>
              <p className="text-t3 text-sm">The community is safe. Long may it stay so.</p>
            </div>
          )}

          {pendingReqs.length > 0 && (
            <div>
              <p className="label mb-3">Open for voting</p>
              <div className="space-y-3">
                {pendingReqs.map(r => (
                  <RequestCard key={r.pubkey.toString()} request={r}
                    pool={pool} member={member} wallet={wallet} onRefetch={onRefetch} />
                ))}
              </div>
            </div>
          )}

          {closedReqs.length > 0 && (
            <div className={pendingReqs.length > 0 ? "mt-6" : ""}>
              <p className="label mb-3">Closed</p>
              <div className="space-y-3">
                {closedReqs.map(r => (
                  <RequestCard key={r.pubkey.toString()} request={r}
                    pool={pool} member={member} wallet={wallet} onRefetch={onRefetch} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
