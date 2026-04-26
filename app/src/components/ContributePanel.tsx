import { useState } from "react";
import toast from "react-hot-toast";
import { PoolData, MemberData } from "../hooks/usePool";
import { formatAudd, fromAuddBaseUnits } from "../utils/audd";
import { useContribute } from "../hooks/useContribute";

export default function ContributePanel({ pool, member, onRefetch }: {
  pool: PoolData; member: MemberData; onRefetch: () => void;
}) {
  const minAudd = fromAuddBaseUnits(pool.minContribution);
  const [amount, setAmount] = useState(minAudd.toString());
  const { contribute, loading } = useContribute(pool, onRefetch);

  const parsed     = parseFloat(amount) || 0;
  const isBelowMin = parsed > 0 && parsed < minAudd;
  const memberBal  = fromAuddBaseUnits(pool.totalBalance);
  const shareP     = memberBal > 0
    ? ((fromAuddBaseUnits(member.totalContributed) / memberBal) * 100).toFixed(1)
    : "0.0";

  const streakColor =
    member.contributionStreak >= 10 ? "var(--gold)"  :
    member.contributionStreak >= 5  ? "var(--teal)"  :
    member.contributionStreak >= 1  ? "var(--amber)" :
    "var(--t4)";

  const presets = [1, 2, 5, 10].map(m => m * minAudd);

  const go = () => {
    if (parsed <= 0)  return toast.error("Enter an amount");
    if (isBelowMin)   return toast.error(`Minimum is ${minAudd} AUDD`);
    contribute(parsed);
  };

  return (
    <div className="card" style={{ borderRadius: "var(--r-xl)" }}>
      <div className="topper-gold" />
      <div className="p-5">
        {/* Header */}
        <div className="flex items-center justify-between mb-5">
          <div>
            <p className="font-display font-bold text-t1 text-lg">Contribute</p>
            <p className="text-xs mt-0.5" style={{ color: "var(--t3)" }}>Add AUDD to the shared vault</p>
          </div>
          <div className="text-right">
            <p className="label mb-0.5">Your share</p>
            <p className="font-display font-bold text-xl num-gold">{shareP}%</p>
          </div>
        </div>

        {/* Stat chips */}
        <div className="grid grid-cols-2 gap-2 mb-5">
          {[
            { label: "You've contributed", val: formatAudd(member.totalContributed), col: "var(--gold)" },
            { label: "Pool minimum",       val: formatAudd(pool.minContribution),    col: "var(--t1)"  },
            {
              label: "Streak",
              val:   member.contributionStreak > 0 ? `${member.contributionStreak}🔥` : "—",
              col:   streakColor,
            },
            { label: "Reputation", val: member.reputationScore.toString(), col: "var(--violet)" },
          ].map(({ label, val, col }) => (
            <div key={label} className="card-inner p-3.5">
              <p className="label mb-1">{label}</p>
              <p className="font-display font-bold text-sm" style={{ color: col }}>{val}</p>
            </div>
          ))}
        </div>

        {/* Amount input */}
        <div className="mb-3">
          <label className="label block mb-2">Amount (AUDD)</label>
          <div className="relative">
            <input
              type="number" value={amount}
              onChange={e => setAmount(e.target.value)}
              min={minAudd} step="1"
              className={`input pr-16 ${isBelowMin ? "input-error" : ""}`}
              placeholder="0.00"
            />
            <span className="absolute right-4 top-1/2 -translate-y-1/2 font-mono text-xs"
              style={{ color: "var(--t3)" }}>AUDD</span>
          </div>
          {isBelowMin && (
            <p className="text-xs mt-1.5" style={{ color: "var(--rose)" }}>
              Minimum is {minAudd.toLocaleString("en-AU")} AUDD
            </p>
          )}
        </div>

        {/* Quick presets */}
        <div className="grid grid-cols-4 gap-1.5 mb-5">
          {presets.map(p => (
            <button key={p} onClick={() => setAmount(p.toString())}
              className="py-2 rounded-lg text-xs font-semibold transition-all"
              style={{
                background:   parseFloat(amount) === p ? "rgba(212,184,106,0.12)" : "var(--s1)",
                border:       `1px solid ${parseFloat(amount) === p ? "rgba(212,184,106,0.3)" : "var(--b2)"}`,
                color:        parseFloat(amount) === p ? "var(--gold)" : "var(--t3)",
              }}>
              {p >= 1000 ? `${p/1000}k` : p}
            </button>
          ))}
        </div>

        <button onClick={go} disabled={loading || parsed <= 0 || isBelowMin}
          className="btn btn-gold w-full text-sm">
          {loading
            ? <><span className="spinner" />Processing…</>
            : `Contribute ${parsed > 0 ? parsed.toLocaleString("en-AU") : "0"} AUDD`}
        </button>
      </div>
    </div>
  );
}
