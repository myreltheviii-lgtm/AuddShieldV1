import { useState } from "react";
import Head from "next/head";
import Link from "next/link";
import { useWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { PublicKey } from "@solana/web3.js";
import CreatePool from "../components/CreatePool";

export default function PoolsPage() {
  const { connected } = useWallet();
  const [showCreate,   setShowCreate]   = useState(false);
  const [address,      setAddress]      = useState("");
  const [addressError, setAddressError] = useState("");

  const go = () => {
    try {
      new PublicKey(address.trim());
      window.location.href = `/pool/${address.trim()}`;
    } catch {
      setAddressError("Not a valid Solana public key");
    }
  };

  return (
    <>
      <Head><title>Pools — AUDDShield</title></Head>
      <div className="min-h-screen">
        <nav className="nav px-6 md:px-10 py-4 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center text-sm"
              style={{ background: "linear-gradient(135deg,#C9A84C,#E6C96A)" }}>🛡</div>
            <span className="font-display font-bold text-t1">AUDDShield</span>
          </Link>
          <div className="flex items-center gap-3">
            {connected && <Link href="/dashboard" className="text-t3 hover:text-t1 text-sm transition-colors">Dashboard</Link>}
            <WalletMultiButton />
          </div>
        </nav>

        <div className="max-w-3xl mx-auto px-4 py-12">
          <div className="flex items-center justify-between mb-10">
            <div>
              <h1 className="font-display font-extrabold text-t1 text-3xl" style={{ letterSpacing: "-0.03em" }}>
                Community Pools
              </h1>
              <p className="text-t3 text-sm mt-1">Join or create a community emergency fund</p>
            </div>
            {connected && (
              <button onClick={() => setShowCreate(v => !v)} className="btn btn-gold text-sm px-5 py-2.5">
                {showCreate ? "Close" : "+ New Pool"}
              </button>
            )}
          </div>

          {!connected && (
            <div className="card p-12 text-center mb-8" style={{ borderRadius: "var(--r-xl)" }}>
              <p className="text-4xl mb-4">👛</p>
              <p className="font-display font-bold text-t1 text-xl mb-2">Connect your wallet</p>
              <p className="text-t3 text-sm mb-6">Required to create or join pools</p>
              <WalletMultiButton />
            </div>
          )}

          {showCreate && connected && (
            <div className="mb-10">
              <p className="font-display font-bold text-t1 text-xl mb-4">Create New Pool</p>
              <CreatePool />
            </div>
          )}

          {/* Pool lookup */}
          <div className="card p-6" style={{ borderRadius: "var(--r-xl)" }}>
            <p className="font-display font-bold text-t1 mb-1">Open a Pool</p>
            <p className="text-t3 text-sm mb-4">
              Paste a pool account address to open it directly
            </p>
            <div className="flex gap-2">
              <input type="text" value={address}
                onChange={e => { setAddress(e.target.value); setAddressError(""); }}
                placeholder="Pool public key (base58)"
                className={`input flex-1 font-mono text-sm ${addressError ? "input-error" : ""}`}
              />
              <button onClick={go} disabled={!address.trim()} className="btn btn-gold text-sm px-5">
                Open →
              </button>
            </div>
            {addressError && <p className="text-xs mt-1.5" style={{ color: "var(--rose)" }}>{addressError}</p>}
          </div>

          {/* Indexer note */}
          <div className="mt-4 px-4 py-3.5 rounded-xl text-xs leading-relaxed"
            style={{ background: "rgba(212,184,106,0.04)", border: "1px solid rgba(212,184,106,0.12)", color: "var(--t3)" }}>
            <span style={{ color: "var(--gold)", fontWeight: 600 }}>💡 Pool discovery:</span>{" "}
            AUDDShield emits on-chain{" "}
            <code style={{ color: "var(--teal)", fontFamily: "DM Mono, monospace" }}>PoolCreated</code>{" "}
            events. Connect a Geyser plugin or Helius webhook to build a full discovery directory.
          </div>
        </div>
      </div>
    </>
  );
}
