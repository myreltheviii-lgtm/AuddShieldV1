import { useState } from "react";
import { useConnection, useAnchorWallet } from "@solana/wallet-adapter-react";
import { SystemProgram, SYSVAR_RENT_PUBKEY } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { BN } from "@coral-xyz/anchor";
import toast from "react-hot-toast";
import { getProvider, getProgram, getPoolPda, getVaultPda, getMemberPda } from "../utils/anchor";
import { PROGRAM_ID, AUDD_MINT_DEVNET, toAuddBaseUnits } from "../utils/audd";

export default function CreatePool() {
  const { connection } = useConnection();
  const wallet         = useAnchorWallet();

  const [name,         setName]         = useState("");
  const [minContrib,   setMinContrib]   = useState("10");
  const [threshold,    setThreshold]    = useState("60");
  const [maxMembers,   setMaxMembers]   = useState("20");
  const [intervalDays, setIntervalDays] = useState("30");
  const [maxReqPct,    setMaxReqPct]    = useState("30");
  const [loading,      setLoading]      = useState(false);

  const nameBytes   = new TextEncoder().encode(name).length;
  const nameTooLong = nameBytes > 32;

  const handleCreate = async () => {
    if (!wallet || !name.trim() || nameTooLong) return;
    setLoading(true);
    const tid = toast.loading("Creating pool…");
    try {
      const idl           = await import("../idl/auddshield.json");
      const provider      = getProvider(connection, wallet);
      const program       = getProgram(provider, idl as any);
      const [poolPda]     = getPoolPda(wallet.publicKey, name, PROGRAM_ID);
      const [vaultPda]    = getVaultPda(poolPda, PROGRAM_ID);
      const [adminMember] = getMemberPda(poolPda, wallet.publicKey, PROGRAM_ID);

      await (program.methods as any)
        .createPool(name, new BN(toAuddBaseUnits(parseFloat(minContrib))),
          parseInt(threshold), parseInt(maxMembers), parseInt(intervalDays), parseInt(maxReqPct))
        .accounts({ admin: wallet.publicKey, auddMint: AUDD_MINT_DEVNET,
          pool: poolPda, vault: vaultPda, adminMember,
          tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId, rent: SYSVAR_RENT_PUBKEY })
        .rpc();

      toast.success(`"${name}" created!`, { id: tid });
      setName("");
    } catch (e: any) { toast.error(e.message || "Failed", { id: tid }); }
    finally { setLoading(false); }
  };

  const fields = [
    { label: "Min Contribution (AUDD)", hint: "per interval", val: minContrib, set: setMinContrib, min: "1" },
    { label: "Vote Threshold (%)",      hint: "e.g. 60",      val: threshold,  set: setThreshold,  min: "1", max: "100" },
    { label: "Max Members",             hint: "2–500",        val: maxMembers, set: setMaxMembers,  min: "2", max: "500" },
    { label: "Contrib Interval (days)", hint: "0 = none",     val: intervalDays, set: setIntervalDays, min: "0" },
    { label: "Request Cap (% of pool)", hint: "max single request", val: maxReqPct, set: setMaxReqPct, min: "1", max: "100" },
  ];

  return (
    <div className="card" style={{ borderRadius: "var(--r-xl)" }}>
      <div className="topper-full" />
      <div className="p-6 md:p-8">
        {/* Name */}
        <div className="mb-5">
          <div className="flex items-center justify-between mb-2">
            <label className="label">Pool Name</label>
            <span className="text-xs" style={{ color: nameTooLong ? "var(--rose)" : "var(--t4)" }}>
              {nameBytes}/32 bytes
            </span>
          </div>
          <input type="text" value={name}
            onChange={e => setName(e.target.value)}
            placeholder="e.g. Sydney Naija Collective"
            className={`input text-base ${nameTooLong ? "input-error" : ""}`}
          />
          {nameTooLong && (
            <p className="text-xs mt-1.5" style={{ color: "var(--rose)" }}>
              Exceeds 32-byte Solana PDA seed limit
            </p>
          )}
        </div>

        {/* Config grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
          {fields.map(({ label, hint, val, set, min, max }) => (
            <div key={label}>
              <div className="flex items-center justify-between mb-2">
                <label className="label">{label}</label>
                {hint && <span className="text-xs" style={{ color: "var(--t4)" }}>{hint}</span>}
              </div>
              <input type="number" value={val}
                onChange={e => set(e.target.value)}
                min={min} max={max}
                className="input" />
            </div>
          ))}
        </div>

        {/* Preview strip */}
        <div className="flex flex-wrap gap-x-5 gap-y-2 px-4 py-3 rounded-lg mb-6"
          style={{ background: "var(--s1)", border: "1px solid var(--b2)" }}>
          {[
            ["Min",       `${minContrib} AUDD`],
            ["Threshold", `${threshold}%`      ],
            ["Members",   maxMembers            ],
            ["Interval",  `${intervalDays}d`   ],
            ["Cap",       `${maxReqPct}%`       ],
          ].map(([k, v]) => (
            <div key={k} className="flex items-center gap-1.5">
              <span className="text-xs" style={{ color: "var(--t4)" }}>{k}</span>
              <span className="font-mono text-xs font-medium" style={{ color: "var(--gold)" }}>{v}</span>
            </div>
          ))}
        </div>

        <button onClick={handleCreate}
          disabled={loading || !name.trim() || nameTooLong}
          className="btn btn-gold w-full text-sm">
          {loading
            ? <><span className="spinner" />Creating pool…</>
            : "Create Community Pool"}
        </button>
      </div>
    </div>
  );
}
