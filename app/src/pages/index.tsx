import Head from "next/head";
import Link from "next/link";
import { useWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";

export default function Home() {
  const { connected } = useWallet();

  return (
    <>
      <Head>
        <title>AUDDShield — Community Emergency Pool</title>
        <meta name="description" content="On-chain mutual aid for real communities, powered by AUDD stablecoin on Solana." />
      </Head>

      <div className="min-h-screen flex flex-col">

        {/* ── NAV ────────────────────────────────────────────────────────── */}
        <nav className="nav px-6 md:px-10 py-4 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-3 group">
            <div className="w-9 h-9 rounded-lg flex items-center justify-center"
              style={{ background: "linear-gradient(135deg,#C9A84C,#E6C96A)" }}>
              <span className="text-base">🛡</span>
            </div>
            <span className="font-display font-bold text-t1 text-lg tracking-tight">AUDDShield</span>
          </Link>
          <div className="flex items-center gap-2 md:gap-4">
            {connected && (
              <>
                <Link href="/pools"
                  className="text-t3 hover:text-t1 text-sm transition-colors hidden md:block">
                  Pools
                </Link>
                <Link href="/dashboard"
                  className="text-t3 hover:text-t1 text-sm transition-colors hidden md:block">
                  Dashboard
                </Link>
              </>
            )}
            <WalletMultiButton />
          </div>
        </nav>

        {/* ── HERO ───────────────────────────────────────────────────────── */}
        <section className="relative flex-1 flex flex-col items-center justify-center px-6 pt-24 pb-32 text-center overflow-hidden">

          {/* Decorative orbs */}
          <div className="absolute top-1/4 left-1/4 w-96 h-96 rounded-full pointer-events-none"
            style={{ background: "radial-gradient(circle, rgba(212,184,106,0.06) 0%, transparent 70%)", transform: "translate(-50%,-50%)" }} />
          <div className="absolute bottom-1/4 right-1/4 w-80 h-80 rounded-full pointer-events-none"
            style={{ background: "radial-gradient(circle, rgba(0,201,167,0.05) 0%, transparent 70%)", transform: "translate(50%,50%)" }} />

          {/* Eyebrow */}
          <div className="anim-1 inline-flex items-center gap-2.5 mb-8 px-4 py-2 rounded-full"
            style={{ background: "rgba(212,184,106,0.07)", border: "1px solid rgba(212,184,106,0.2)" }}>
            <span className="pulse-dot pulse-dot-gold" />
            <span className="text-gold text-xs font-semibold tracking-wide uppercase">
              Live on Solana Devnet
            </span>
          </div>

          {/* Headline */}
          <h1 className="anim-2 font-display font-extrabold text-hero text-t1 max-w-4xl mb-6">
            Your community&apos;s<br />
            <span className="shimmer-gold">safety net,</span>{" "}
            <span style={{ color: "var(--t3)" }}>on-chain.</span>
          </h1>

          <p className="anim-3 text-t2 text-lg md:text-xl max-w-2xl mx-auto leading-relaxed mb-10">
            Pool AUDD stablecoin with trusted people. When someone faces an emergency,
            the community votes — weighted by contribution history — and funds release automatically.
            No banks. No middlemen. No trust required.
          </p>

          {/* CTA row */}
          <div className="anim-4 flex items-center gap-3 flex-wrap justify-center">
            {connected ? (
              <>
                <Link href="/pools" className="btn btn-gold text-sm px-7 py-3">
                  Browse Pools →
                </Link>
                <Link href="/dashboard" className="btn btn-ghost text-sm px-7 py-3">
                  My Dashboard
                </Link>
              </>
            ) : (
              <div className="flex flex-col items-center gap-3">
                <WalletMultiButton />
                <p className="text-t4 text-xs">Phantom · Solflare · Backpack supported</p>
              </div>
            )}
          </div>

        </section>

        {/* ── HOW IT WORKS ───────────────────────────────────────────────── */}
        <section className="px-6 md:px-10 pb-24">
          <div className="max-w-5xl mx-auto">

            <div className="text-center mb-14">
              <div className="label mb-3">How it works</div>
              <h2 className="font-display font-bold text-display text-t1">
                Three steps to mutual security
              </h2>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {[
                {
                  step: "01",
                  icon: "🏊",
                  title: "Create or join a pool",
                  body: "Form a group with people you trust — friends, family, community. Set contribution minimums and voting rules.",
                  accent: "var(--gold)",
                  border: "rgba(212,184,106,0.15)",
                },
                {
                  step: "02",
                  icon: "💰",
                  title: "Contribute AUDD monthly",
                  body: "Regular deposits build your contribution streak and increase your governance weight. Idle funds stay in a non-custodial vault.",
                  accent: "var(--teal)",
                  border: "rgba(0,201,167,0.15)",
                },
                {
                  step: "03",
                  icon: "🗳️",
                  title: "Vote on emergencies",
                  body: "When a member requests funds, a 5-day vote opens. Weighted approval releases funds automatically — no admin required.",
                  accent: "var(--violet)",
                  border: "rgba(155,114,255,0.15)",
                },
              ].map(({ step, icon, title, body, accent, border }) => (
                <div key={step} className="card p-6 group"
                  style={{ borderColor: border }}>
                  <div className="flex items-start justify-between mb-5">
                    <div className="w-11 h-11 rounded-lg flex items-center justify-center text-xl"
                      style={{ background: `${accent}12`, border: `1px solid ${accent}22` }}>
                      {icon}
                    </div>
                    <span className="font-display font-extrabold text-4xl"
                      style={{ color: `${accent}18`, letterSpacing: "-0.04em" }}>
                      {step}
                    </span>
                  </div>
                  <h3 className="font-display font-bold text-t1 text-lg mb-2">{title}</h3>
                  <p className="text-t2 text-sm leading-relaxed">{body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── TRUST PILLARS ──────────────────────────────────────────────── */}
        <section className="px-6 md:px-10 pb-24">
          <div className="max-w-5xl mx-auto">
            <div className="card-inner p-6 md:p-10 rounded-xl"
              style={{ background: "linear-gradient(135deg, var(--s2), var(--s1))", borderRadius: "var(--r-xl)" }}>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                {[
                  { icon: "🔒", title: "Non-custodial", body: "Funds live in a program-owned PDA. No admin can unilaterally withdraw — not even the pool creator." },
                  { icon: "⚖️", title: "Weighted governance", body: "Consistent contributors earn more vote weight. Long-term members' voices are worth more than newcomers." },
                  { icon: "⚡", title: "Permissionless settlement", body: "Anyone can trigger settlement after the deadline. Liveness never depends on a single operator." },
                ].map(({ icon, title, body }) => (
                  <div key={title} className="flex gap-4">
                    <div className="text-2xl mt-0.5 flex-shrink-0">{icon}</div>
                    <div>
                      <p className="font-display font-bold text-t1 text-base mb-1.5">{title}</p>
                      <p className="text-t2 text-sm leading-relaxed">{body}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* ── FOOTER ─────────────────────────────────────────────────────── */}
        <footer className="border-t px-6 py-5 text-center" style={{ borderColor: "var(--b1)" }}>
          <p className="text-t4 text-xs">
            AUDDShield · Built on Solana · AUDD by audd.io · Open-source protocol
          </p>
        </footer>
      </div>
    </>
  );
}
