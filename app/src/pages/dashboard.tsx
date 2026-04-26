import Head from "next/head";
import Link from "next/link";
import { useWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";

export default function DashboardPage() {
  const { connected, publicKey } = useWallet();

  return (
    <>
      <Head><title>Dashboard — AUDDShield</title></Head>
      <div className="min-h-screen">
        <nav className="nav px-6 md:px-10 py-4 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center text-sm"
              style={{ background: "linear-gradient(135deg,#C9A84C,#E6C96A)" }}>🛡</div>
            <span className="font-display font-bold text-t1">AUDDShield</span>
          </Link>
          <div className="flex items-center gap-3">
            <Link href="/pools" className="text-t3 hover:text-t1 text-sm transition-colors">Pools</Link>
            <WalletMultiButton />
          </div>
        </nav>

        <div className="max-w-3xl mx-auto px-4 py-12">
          {!connected ? (
            <div className="card p-16 text-center" style={{ borderRadius: "var(--r-2xl)" }}>
              <div className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-6"
                style={{ background: "rgba(212,184,106,0.08)", border: "1px solid rgba(212,184,106,0.15)" }}>
                <span className="text-2xl">👛</span>
              </div>
              <p className="font-display font-extrabold text-t1 text-2xl mb-2"
                style={{ letterSpacing: "-0.03em" }}>Connect your wallet</p>
              <p className="text-t3 text-sm mb-8">See your pools, contributions, and reputation score</p>
              <WalletMultiButton />
            </div>
          ) : (
            <div className="anim-1 space-y-6">
              {/* Wallet card */}
              <div className="card p-6" style={{ borderRadius: "var(--r-xl)" }}>
                <div className="topper-gold" />
                <div className="pt-2">
                  <p className="label mb-2">Connected Wallet</p>
                  <p className="font-mono text-t1 text-sm break-all">{publicKey?.toString()}</p>
                </div>
              </div>

              {/* Action cards */}
              <div>
                <p className="font-display font-bold text-t1 text-xl mb-4">What do you want to do?</p>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {[
                    { icon: "🏊", title: "Create a pool",  body: "Start a new community fund for your group.", href: "/pools", cta: "Create →", accent: "var(--gold)"   },
                    { icon: "💰", title: "Contribute",     body: "Add AUDD and build your contribution streak.",href: "/pools", cta: "Find a pool →", accent: "var(--teal)"   },
                    { icon: "🗳️",  title: "Vote",          body: "Review and vote on pending emergency requests.", href: "/pools", cta: "See pools →", accent: "var(--violet)" },
                  ].map(({ icon, title, body, href, cta, accent }) => (
                    <div key={title} className="card p-5 flex flex-col" style={{ borderRadius: "var(--r-lg)" }}>
                      <div className="w-10 h-10 rounded-xl flex items-center justify-center mb-4 text-xl"
                        style={{ background: `${accent}0F`, border: `1px solid ${accent}22` }}>
                        {icon}
                      </div>
                      <p className="font-display font-bold text-t1 text-sm mb-1.5">{title}</p>
                      <p className="text-t3 text-xs leading-relaxed flex-1">{body}</p>
                      <Link href={href} className="mt-4 text-xs font-semibold" style={{ color: accent }}>
                        {cta}
                      </Link>
                    </div>
                  ))}
                </div>
              </div>

              {/* Indexer note */}
              <div className="card p-5" style={{ borderRadius: "var(--r-lg)" }}>
                <div className="flex items-start gap-3">
                  <span className="text-xl mt-0.5">🔍</span>
                  <div>
                    <p className="font-semibold text-t1 text-sm mb-1">Full membership dashboard</p>
                    <p className="text-t3 text-xs leading-relaxed">
                      Showing all pools where you&apos;re a member requires a{" "}
                      <span style={{ color: "var(--gold)" }}>Geyser plugin</span>{" "}
                      or Helius webhook subscribed to{" "}
                      <code style={{ color: "var(--teal)", fontFamily: "DM Mono, monospace", fontSize: 11 }}>MemberJoined</code>{" "}
                      events. Navigate directly to any known pool address to interact.
                    </p>
                    <Link href="/pools" className="inline-flex items-center gap-1.5 mt-3 text-xs font-semibold btn btn-ghost px-3 py-2">
                      Open pool by address →
                    </Link>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
