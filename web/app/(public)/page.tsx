import Link from 'next/link'
import { LandingAccount, SignInCta } from '@/components/auth'
import { Lockup } from '@/components/brand'
import { HeroOtto } from '@/components/landing/hero-otto'
import { TypedIntent } from '@/components/landing/typed-intent'
import { BubbleField, SeaLife, type SeaCreature } from '@/components/motion'
import { AssetIcon } from '@/components/portfolio/asset-icon'
import { GitHub, REPO_URL } from '@/components/shell'
import { Card, buttonClasses } from '@/components/ui'
import { WALLET_NAMES, walletMark } from '@/components/wallets/naming'

/**
 * The landing page. Copy is settled — see #6 — and used verbatim.
 *
 * This is the only page in the product where the water is loud, and even here
 * it stays out from under the words: the review page's gradient, its two
 * caustic washes, the bubbles and the creatures sit behind the hero's padding
 * and around Otto, never behind the headline. It has to read as ocean with
 * motion off, so depth and caustics carry it and the rest is the garnish.
 *
 * Outside the app shell on purpose. The brand bar carries the lockup, the
 * repo, and either a greeting that opens the app or a Sign in button.
 */

/**
 * The hero's creatures: the review page's species, placed where the words
 * are not. The right half is Otto's, and the bottom edge is open water.
 */
const HERO_LIFE: readonly SeaCreature[] = [
  { species: 'fish', left: 92, top: 18, size: 20, travel: -160, lift: -12, delay: 0, duration: 64, opacity: 0.8 },
  { species: 'turtle', left: 66, top: 76, size: 30, travel: 200, lift: -16, delay: 10, duration: 90, opacity: 0.75 },
  { species: 'jelly', left: 96, top: 58, size: 22, travel: 10, lift: -120, delay: 6, duration: 56, opacity: 0.7 },
  { species: 'jelly', left: 58, top: 86, size: 16, travel: -8, lift: -90, delay: 26, duration: 62, opacity: 0.55 },
  { species: 'fish', left: 78, top: 40, size: 14, travel: -120, lift: 8, delay: 36, duration: 76, opacity: 0.6 },
  { species: 'crab', left: 8, top: 96, size: 20, travel: 90, lift: 0, delay: 3, duration: 46, opacity: 0.8 },
]

/** The wallets on the strip under the hero: the ones whose marks are bundled and that people bring. */
const WORKS_WITH = ['metamask', 'rabby_wallet', 'safe', 'ledger', 'ambire', 'infinex'] as const

const STEPS = [
  {
    n: '01',
    title: 'Link your wallets',
    body: 'Hardware, hot, or a Safe. Up to eight — Otto only has eight arms.',
    glyph: 'M3 7.5A2.5 2.5 0 0 1 5.5 5h12A2.5 2.5 0 0 1 20 7.5v9a2.5 2.5 0 0 1-2.5 2.5h-12A2.5 2.5 0 0 1 3 16.5zM3 10h17M15 13.5h2',
  },
  {
    n: '02',
    title: 'Point your agent at Ottopus',
    body: 'Works with Claude, Codex, or whatever you already talk to. Nothing to install.',
    glyph: 'M9 3v5M15 3v5M6 8h12v3a6 6 0 0 1-12 0zM12 17v4',
  },
  {
    n: '03',
    title: 'Say what you want',
    body: '“Swap 500 USDC for ETH.” You get back plain language describing exactly what will happen, and you sign it in your own wallet, like always.',
    glyph: 'M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v7a2.5 2.5 0 0 1-2.5 2.5H10l-4.5 4v-4A2.5 2.5 0 0 1 4 13.5zM8 9h8M8 12h5',
  },
]

export default function Landing() {
  return (
    <div className="flex min-h-dvh flex-col">
      {/* The brand bar, as the app design draws it: navy ground, cream lockup,
          a cream hairline underneath. Navy and cream are the two tokens that do
          not move between themes, so this bar looks identical in both. */}
      <header
        className={
          'sticky top-0 z-50 flex flex-wrap items-center justify-between gap-x-4 gap-y-2.5 ' +
          'border-b border-[rgba(255,240,220,0.14)] bg-[var(--ot-navy)] px-5 py-[14px] sm:px-8'
        }
      >
        <Lockup layout="horizontal" tone="reversed" size={30} />
        <div className="flex items-center gap-1.5">
          <a
            href={REPO_URL}
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-9 items-center gap-2 rounded-full px-3 text-[13px] font-medium text-[var(--ot-cream)] transition-colors hover:bg-[rgba(255,240,220,0.1)]"
          >
            <GitHub />
            <span className="hidden sm:inline">GitHub</span>
          </a>
          <LandingAccount />
        </div>
      </header>

      <main className="flex flex-1 flex-col">
        {/* Hero. The app's water lives on this section only, clipped as one
            layer so the caustic sheets never wash past its edge. */}
        <section className="ot-review-sea relative overflow-hidden px-5 py-14 sm:px-10 sm:py-20">
          <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
            <div className="ot-caustic" />
            <div className="ot-caustic ot-caustic--b" />
            <BubbleField pattern="canvas" />
            <SeaLife creatures={HERO_LIFE} />
          </div>

          <div className="relative mx-auto grid w-full max-w-[1100px] items-center gap-10 lg:grid-cols-[minmax(0,1fr)_280px]">
            <div className="flex flex-col gap-5">
              <h1 className="font-display max-w-[20ch] text-[38px] leading-[1.05] font-bold tracking-[-0.025em] text-pretty sm:text-[52px]">
                Stop juggling wallets to get one thing done
              </h1>

              <p className="max-w-[54ch] text-[17px] leading-[1.55] text-pretty text-[var(--ot-text-2)] sm:text-[18px]">
                Tell your agent what you want, not where to find it. Ottopus works out which
                wallet, which chain and which app — then shows you exactly what will happen before
                anything moves.
              </p>

              {/* What you would say — typed, the way you would type it. */}
              <TypedIntent className="font-mono text-[15px] text-[var(--ot-text)] sm:text-[16px]" />

              <div className="flex flex-wrap items-center gap-2">
                <SignInCta>Link your first wallet</SignInCta>
                <Link href="/review/demo" className={buttonClasses({ variant: 'ghost', size: 'lg' })}>
                  See what a review looks like
                </Link>
              </div>

              <p className="text-[13px] text-[var(--ot-text-3)]">
                Ottopus never holds a key and never asks for a seed phrase.
              </p>

              {/* One quiet row: any wallet, and the marks of the ones people bring. */}
              <ul className="m-0 flex list-none flex-wrap items-center gap-x-3 gap-y-2 p-0 pt-1" aria-label="Works with any wallet">
                <li className="text-[11px] font-semibold tracking-[0.06em] text-[var(--ot-text-3)] uppercase">Works with any wallet</li>
                {WORKS_WITH.map((type) => (
                  <li key={type} className="flex items-center gap-1.5 text-[12px] text-[var(--ot-text-2)]">
                    <AssetIcon url={walletMark(type)} name={WALLET_NAMES[type] ?? type} size={18} className="ring-[var(--ot-card)]" />
                    {WALLET_NAMES[type]}
                  </li>
                ))}
              </ul>
            </div>

            {/* Below lg he follows the pitch rather than leading it: 280px of
                octopus before the headline buries what the product is. */}
            <HeroOtto className="mx-auto lg:mx-0" />
          </div>
        </section>

        {/* Everything below carries copy, so the water stops here. */}
        <section className="border-t border-[var(--ot-border)] px-5 py-9 sm:px-10">
          <div className="mx-auto flex w-full max-w-[1100px] flex-col gap-4">
            <h2 className="font-display text-[24px] leading-[1.2] font-bold tracking-[-0.02em] sm:text-[28px]">
              One conversation instead of six tabs
            </h2>
            <p className="max-w-[74ch] text-[16px] leading-[1.6] text-pretty text-[var(--ot-text-3)]">
              <span className="font-semibold text-[var(--ot-text-2)]">Today:</span> work out which
              wallet has the funds, bridge to the right chain, find the right app, approve, swap,
              hope you read it right.
            </p>
            <p className="max-w-[74ch] text-[16px] leading-[1.6] text-pretty text-[var(--ot-text)]">
              <span className="font-semibold">With Ottopus:</span> say it once. Otto picks the
              wallet and tells you why, builds the route, and hands you one link that explains
              itself.
            </p>
          </div>
        </section>

        <section className="px-5 pb-9 sm:px-10">
          <Card className="mx-auto w-full max-w-[1100px] overflow-hidden">
            <ol className="grid sm:grid-cols-3">
              {STEPS.map((step, i) => (
                <li
                  key={step.n}
                  className={
                    'flex flex-col gap-[7px] p-7' +
                    (i > 0 ? ' border-t border-[var(--ot-border)] sm:border-t-0 sm:border-l' : '')
                  }
                >
                  <span className="flex items-center gap-2 text-[var(--ot-text-3)]">
                    <span aria-hidden className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-[var(--ot-surface-3)] text-[var(--ot-text-2)]">
                      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
                        <path d={step.glyph} />
                      </svg>
                    </span>
                    <span className="font-mono text-[12px]">{step.n}</span>
                  </span>
                  <span className="font-display text-[19px] font-bold">{step.title}</span>
                  <span className="text-[14px] leading-[1.5] text-pretty text-[var(--ot-text-2)]">
                    {step.body}
                  </span>
                </li>
              ))}
            </ol>
          </Card>
        </section>
      </main>

      <footer className="flex flex-col items-center gap-4 border-t border-[var(--ot-border)] px-5 py-8 sm:px-10">
        <p className="font-display text-center text-[18px] font-semibold tracking-[-0.01em] text-[var(--ot-text-2)] sm:text-[20px]">
          One intent. Every wallet. You still sign.
        </p>
        <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-2">
          <Lockup layout="horizontal" size={26} />
        </div>
      </footer>
    </div>
  )
}
