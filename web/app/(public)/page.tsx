import Link from 'next/link'
import type { CSSProperties } from 'react'
import { LandingAccount, SignInCta } from '@/components/auth'
import { Lockup } from '@/components/brand'
import { ConnectTabs } from '@/components/landing/connect-tabs'
import { DemoRunCard } from '@/components/landing/demo-run'
import { Spotlight } from '@/components/landing/spotlight'
import { BubbleField, SeaLife, type SeaCreature } from '@/components/motion'
import { AssetIcon } from '@/components/portfolio/asset-icon'
import { GitHub, REPO_URL } from '@/components/shell'
import { Card, IssuerMark, buttonClasses } from '@/components/ui'
import { WALLET_NAMES, walletMark } from '@/components/wallets/naming'

/**
 * The landing page, led by tokenized stocks on BNB Chain. The promise
 * underneath is unchanged: no wallet juggling, no dapp hopping, and you still
 * sign — or a rule you set does, for an agent's own wallet.
 *
 * The hero shows rather than tells: a run plays out on the right, from the
 * sentence to the review link, so the product is understood before it is read.
 *
 * This is the only page in the product where the water is loud, and even here
 * it stays out from under the words: the gradient, the two caustic washes, the
 * bubbles and the creatures sit behind the hero alone. Below it, motion is the
 * scroll's own — scroll-driven CSS that settles into a still page.
 *
 * Outside the app shell on purpose. The brand bar carries the lockup, the
 * repo, and either a greeting that opens the app or a Sign in button.
 */

/** Where this was built, said once in the hero and once in the footer. */
const BUILT_DURING = 'Built during BNB Hack: Tokenized Stocks Edition'

/** The hero's creatures, kept to the edges and the open water at the bottom. */
const HERO_LIFE: readonly SeaCreature[] = [
  { species: 'fish', left: 48, top: 12, size: 18, travel: -160, lift: -12, delay: 0, duration: 64, opacity: 0.7 },
  { species: 'turtle', left: 40, top: 90, size: 28, travel: 200, lift: -16, delay: 10, duration: 90, opacity: 0.7 },
  { species: 'jelly', left: 97, top: 62, size: 22, travel: 10, lift: -120, delay: 6, duration: 56, opacity: 0.65 },
  { species: 'jelly', left: 3, top: 70, size: 16, travel: -8, lift: -90, delay: 26, duration: 62, opacity: 0.5 },
  { species: 'crab', left: 8, top: 97, size: 20, travel: 90, lift: 0, delay: 3, duration: 46, opacity: 0.75 },
]

/** What the hero promises away, as three quiet ticks. */
const NO_MORE = ['No wallet juggling', 'No dapp hopping', 'No keys shared'] as const

/** The stocks strip. Tickers and names only: a landing page quotes no prices. */
const STOCKS = [
  ['NVDA', 'NVIDIA'],
  ['TSLA', 'Tesla'],
  ['AAPL', 'Apple'],
  ['MSFT', 'Microsoft'],
  ['GOOGL', 'Alphabet'],
  ['AMZN', 'Amazon'],
  ['META', 'Meta'],
  ['COIN', 'Coinbase'],
  ['MSTR', 'Strategy'],
  ['SPY', 'S&P 500'],
  ['QQQ', 'Nasdaq 100'],
] as const

/** The issuers Ottopus compares, in the registry's words. */
const ISSUERS = [
  ['bstock', 'NVDAB'],
  ['ondo', 'NVDAon'],
  ['xstocks', 'NVDAx'],
] as const

/** The six tabs a stock trade takes today, scattered, before they gather. */
const CLUTTER: readonly { label: string; sub: string; x: number; y: number; r: number; mark?: string }[] = [
  { label: 'MetaMask', sub: 'wrong chain', x: -150, y: -92, r: -8, mark: 'metamask' },
  { label: 'Rabby', sub: 'has the USDT?', x: 138, y: -104, r: 6, mark: 'rabby_wallet' },
  { label: 'Bridge', sub: 'Base → BNB', x: -178, y: 14, r: 5 },
  { label: 'Issuer site', sub: 'which NVDA token?', x: 170, y: 6, r: -5 },
  { label: 'DEX', sub: 'approve, then swap', x: -112, y: 112, r: -4 },
  { label: 'BscScan', sub: 'did it land?', x: 124, y: 110, r: 7 },
]

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
    body: '“Buy NVIDIA with 50 USDT.” Otto compares every issuer’s token, picks the wallet that can pay, and hands you one link that explains itself.',
    glyph: 'M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v7a2.5 2.5 0 0 1-2.5 2.5H10l-4.5 4v-4A2.5 2.5 0 0 1 4 13.5zM8 9h8M8 12h5',
  },
]

/** The wallets on the "your wallets" card: bundled marks people bring. */
const WORKS_WITH = ['metamask', 'rabby_wallet', 'safe', 'ledger', 'binance_wallet', 'infinex'] as const

export default function Landing() {
  return (
    <div className="flex min-h-dvh flex-col">
      {/* The brand bar, as the app design draws it: navy ground, cream lockup,
          a cream hairline underneath. Navy and cream are the two tokens that do
          not move between themes, so this bar looks identical in both. The
          hairline fills as the page scrolls. */}
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
        <span aria-hidden className="ot-scroll-progress" />
      </header>

      <main className="flex flex-1 flex-col overflow-x-clip">
        {/* Hero. The app's water lives on this section only, clipped as one
            layer so the caustic sheets never wash past its edge. */}
        <section className="ot-review-sea relative overflow-hidden px-5 pt-12 pb-16 sm:px-10 sm:pt-16 sm:pb-24">
          <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
            <div className="ot-caustic" />
            <div className="ot-caustic ot-caustic--b" />
            <BubbleField pattern="canvas" />
            <SeaLife creatures={HERO_LIFE} />
          </div>

          <div className="relative mx-auto grid w-full max-w-[1140px] items-center gap-x-14 gap-y-24 lg:grid-cols-[minmax(0,1fr)_440px]">
            <div className="flex flex-col gap-5">
              <span className="ot-hack-pill">{BUILT_DURING}</span>

              <h1 className="font-display m-0 text-[40px] leading-[1.06] font-bold tracking-[-0.03em] text-balance sm:text-[52px]">
                Just ask for the stock.
                <br />
                <span className="ot-headline-glow">Otto handles the wallets.</span>
              </h1>

              <p className="m-0 max-w-[52ch] text-[17px] leading-[1.55] text-pretty text-[var(--ot-text-2)] sm:text-[18px]">
                Tell your agent what you want, not where to find it. Ottopus finds the tokenized
                stock across every issuer, picks the wallet that can pay, and shows you exactly
                what will happen before anything moves.
              </p>

              <ul className="m-0 flex list-none flex-wrap gap-x-4 gap-y-1.5 p-0">
                {NO_MORE.map((line) => (
                  <li key={line} className="flex items-center gap-1.5 text-[14px] font-medium text-[var(--ot-text)]">
                    <span aria-hidden className="inline-flex h-[18px] w-[18px] items-center justify-center rounded-full bg-[var(--ot-ok-bg)] text-[var(--ot-ok-text)]">
                      <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round">
                        <path d="M5 12.5l4.5 4.5L19 7" />
                      </svg>
                    </span>
                    {line}
                  </li>
                ))}
              </ul>

              <div className="flex flex-wrap items-center gap-2 pt-1">
                <SignInCta>Link your first wallet</SignInCta>
                <Link href="/review/demo" className={buttonClasses({ variant: 'ghost', size: 'lg' })}>
                  See what a review looks like
                </Link>
              </div>

              <p className="m-0 text-[13px] text-[var(--ot-text-3)]">
                Ottopus never holds a key and never asks for a seed phrase.
              </p>
            </div>

            <div className="relative mx-auto w-full max-w-[440px] lg:mt-10">
              <div aria-hidden className="ot-demo-halo" />
              <DemoRunCard />
            </div>
          </div>
        </section>

        {/* Everything below carries copy, so the water stops here. */}

        {/* The stocks strip: what you can ask for, and whose tokens get compared. */}
        <section aria-label="Tokenized stocks" className="border-y border-[var(--ot-border)] bg-[var(--ot-surface)] py-4">
          <div className="mx-auto flex w-full max-w-[1140px] flex-col items-center gap-3 px-5 sm:flex-row sm:gap-6 sm:px-10">
            <div className="flex shrink-0 items-center gap-2">
              <span className="text-[11px] font-semibold tracking-[0.06em] text-[var(--ot-text-3)] uppercase">Compares</span>
              {ISSUERS.map(([issuer, ticker]) => (
                <IssuerMark key={issuer} issuer={issuer} ticker={ticker} className="text-[11px]" />
              ))}
            </div>
            <div className="ot-marquee w-full min-w-0 flex-1 overflow-hidden">
              <ul className="ot-marquee__track m-0 list-none p-0">
                {[0, 1].map((copy) =>
                  STOCKS.map(([ticker, name]) => (
                    <li
                      key={`${copy}-${ticker}`}
                      aria-hidden={copy === 1 || undefined}
                      className="flex shrink-0 items-baseline gap-1.5 px-4 text-[14px]"
                    >
                      <span className="font-mono font-semibold text-[var(--ot-text)]">{ticker}</span>
                      <span className="text-[var(--ot-text-3)]">{name}</span>
                    </li>
                  )),
                )}
              </ul>
            </div>
          </div>
        </section>

        {/* Six tabs, gathered into one sentence as the section scrolls by. */}
        <section className="px-5 py-16 sm:px-10 sm:py-24">
          <div className="mx-auto grid w-full max-w-[1140px] items-center gap-12 lg:grid-cols-2">
            <div className="ot-reveal flex flex-col gap-4">
              <h2 className="font-display m-0 text-[28px] leading-[1.15] font-bold tracking-[-0.02em] sm:text-[36px]">
                One conversation instead of six tabs
              </h2>
              <p className="m-0 max-w-[56ch] text-[16px] leading-[1.6] text-pretty text-[var(--ot-text-3)]">
                <span className="font-semibold text-[var(--ot-text-2)]">Today:</span> work out which
                wallet has the USDT, bridge it to BNB Chain, find which issuer’s NVIDIA token is
                the real one, approve, swap, hope you read it right.
              </p>
              <p className="m-0 max-w-[56ch] text-[16px] leading-[1.6] text-pretty text-[var(--ot-text)]">
                <span className="font-semibold">With Ottopus:</span> say it once. Otto picks the
                wallet and tells you why, builds the route, and hands you one link that explains
                itself.
              </p>
            </div>

            <div aria-hidden className="ot-clutter relative flex h-[300px] items-center justify-center max-sm:scale-[0.72] sm:h-[380px]">
              {CLUTTER.map((tab) => (
                <div
                  key={tab.label}
                  className="ot-clutter__tab absolute flex w-[168px] items-center gap-2 rounded-[12px] border border-[var(--ot-border)] bg-[var(--ot-card)] px-3 py-2.5 shadow-[var(--ot-shadow-card)]"
                  style={{ '--x': `${tab.x}px`, '--y': `${tab.y}px`, '--r': `${tab.r}deg` } as CSSProperties}
                >
                  {tab.mark ? (
                    <AssetIcon url={walletMark(tab.mark)} name={tab.label} size={20} />
                  ) : (
                    <span className="h-5 w-5 flex-none rounded-full bg-[var(--ot-surface-3)]" />
                  )}
                  <span className="flex min-w-0 flex-col">
                    <span className="text-[13px] font-semibold">{tab.label}</span>
                    <span className="truncate text-[11px] text-[var(--ot-text-3)]">{tab.sub}</span>
                  </span>
                </div>
              ))}
              <div className="ot-clutter__one relative rounded-[18px] rounded-br-[6px] bg-[var(--ot-navy)] px-5 py-3.5 font-mono text-[15px] text-[var(--ot-cream)] ring-1 ring-[rgba(255,240,220,0.14)] shadow-[0_18px_40px_-16px_rgba(22,33,62,.5)]">
                <span className="mr-2 text-[var(--ot-coral)]">›</span>
                Buy NVIDIA with 50 USDT
              </div>
            </div>
          </div>
        </section>

        {/* How it works. */}
        <section className="px-5 pb-16 sm:px-10 sm:pb-24">
          <div className="mx-auto flex w-full max-w-[1140px] flex-col gap-6">
            <h2 className="ot-reveal font-display m-0 text-[28px] leading-[1.15] font-bold tracking-[-0.02em] sm:text-[36px]">
              Three steps, then just talk
            </h2>
            <Card className="ot-reveal relative overflow-hidden">
              <span aria-hidden className="ot-steps-line absolute inset-x-0 top-0 h-[3px] bg-gradient-to-r from-[var(--ot-coral)] via-[#F3BA2F] to-[var(--ot-plan)]" />
              <ol className="m-0 grid list-none p-0 sm:grid-cols-3">
                {STEPS.map((step, i) => (
                  <li
                    key={step.n}
                    className={
                      'flex flex-col gap-[7px] p-7' +
                      (i > 0 ? ' border-t border-[var(--ot-border)] sm:border-t-0 sm:border-l' : '')
                    }
                  >
                    <span className="flex items-center gap-2 text-[var(--ot-text-3)]">
                      <span aria-hidden className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-[var(--ot-coral-soft)] text-[var(--ot-coral-text)]">
                        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
                          <path d={step.glyph} />
                        </svg>
                      </span>
                      <span className="font-mono text-[12px]">{step.n}</span>
                    </span>
                    <span className="font-display text-[19px] font-bold">{step.title}</span>
                    <span className="text-[14px] leading-[1.5] text-pretty text-[var(--ot-text-2)]">{step.body}</span>
                  </li>
                ))}
              </ol>
            </Card>
          </div>
        </section>

        {/* The two kinds of wallet: the ones you sign with, and your agent's own. */}
        <section className="border-t border-[var(--ot-border)] bg-[var(--ot-surface)] px-5 py-16 sm:px-10 sm:py-24">
          <div className="mx-auto flex w-full max-w-[1140px] flex-col gap-8">
            <div className="ot-reveal flex flex-col gap-3">
              <h2 className="font-display m-0 text-[28px] leading-[1.15] font-bold tracking-[-0.02em] sm:text-[36px]">
                Your wallets, or your agent’s
              </h2>
              <p className="m-0 max-w-[62ch] text-[16px] leading-[1.6] text-pretty text-[var(--ot-text-2)]">
                Either way the agent only ever gets a plan, never a key, and every plan is
                decoded and simulated before anything moves.
              </p>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <Spotlight className="ot-reveal flex flex-col gap-4 rounded-[var(--ot-radius-lg)] border border-[var(--ot-border)] bg-[var(--ot-card)] p-7">
                <span className="w-fit rounded-full bg-[var(--ot-coral-soft)] px-2.5 py-1 text-[11px] font-semibold tracking-[0.06em] text-[var(--ot-coral-text)] uppercase">
                  You sign
                </span>
                <h3 className="font-display m-0 text-[22px] font-bold tracking-[-0.02em]">Your own wallets</h3>
                <p className="m-0 text-[15px] leading-[1.55] text-pretty text-[var(--ot-text-2)]">
                  Link the wallets you already have. Ottopus reads them and picks the one that can
                  pay. You open the review link, check the decoded calls and the simulation, and
                  sign in your own wallet, like always.
                </p>
                <ul className="m-0 mt-auto flex list-none flex-wrap items-center gap-x-3 gap-y-2 p-0 pt-2" aria-label="Works with any wallet">
                  {WORKS_WITH.map((type) => (
                    <li key={type} className="flex items-center gap-1.5 text-[12px] text-[var(--ot-text-2)]">
                      <AssetIcon url={walletMark(type)} name={WALLET_NAMES[type] ?? type} size={18} className="ring-[var(--ot-card)]" />
                      {WALLET_NAMES[type]}
                    </li>
                  ))}
                </ul>
              </Spotlight>

              <Spotlight className="ot-reveal flex flex-col gap-4 rounded-[var(--ot-radius-lg)] border border-[var(--ot-plan-border)] bg-[var(--ot-card)] p-7">
                <span className="w-fit rounded-full bg-[var(--ot-plan-bg)] px-2.5 py-1 text-[11px] font-semibold tracking-[0.06em] text-[var(--ot-plan-text)] uppercase">
                  Agent sends
                </span>
                <h3 className="font-display m-0 text-[22px] font-bold tracking-[-0.02em]">Agent wallets</h3>
                <p className="m-0 text-[15px] leading-[1.55] text-pretty text-[var(--ot-text-2)]">
                  Give your agent a wallet of its own. Its key stays with the wallet’s vendor and
                  Ottopus only sees the address. The agent sends a plan only once you approve it,
                  or once a rule you set approves it after a passing simulation.
                </p>
                <ul className="m-0 mt-auto flex list-none flex-col gap-2 p-0 pt-2">
                  {['Rules you set: which assets, how much, how often', 'Simulated first, every time', 'Ottopus never signs and never broadcasts'].map((line) => (
                    <li key={line} className="flex items-center gap-2 text-[13px] text-[var(--ot-text-2)]">
                      <span aria-hidden className="h-1.5 w-1.5 flex-none rounded-full bg-[var(--ot-plan)]" />
                      {line}
                    </li>
                  ))}
                </ul>
              </Spotlight>
            </div>
          </div>
        </section>

        {/* Connect: the one line an agent needs. */}
        <section className="px-5 py-16 sm:px-10 sm:py-24">
          <div className="mx-auto grid w-full max-w-[1140px] items-center gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,560px)]">
            <div className="ot-reveal flex flex-col gap-3">
              <h2 className="font-display m-0 text-[28px] leading-[1.15] font-bold tracking-[-0.02em] sm:text-[36px]">
                One line to connect
              </h2>
              <p className="m-0 max-w-[48ch] text-[16px] leading-[1.6] text-pretty text-[var(--ot-text-2)]">
                A remote MCP server with OAuth. Nothing to install and no key to paste. The first
                call opens a page where you choose what your agent may do.
              </p>
            </div>
            <div className="ot-reveal">
              <ConnectTabs />
            </div>
          </div>
        </section>
      </main>

      <footer className="flex flex-col items-center gap-4 border-t border-[var(--ot-border)] px-5 py-10 sm:px-10">
        <p className="font-display m-0 text-center text-[18px] font-semibold tracking-[-0.01em] text-[var(--ot-text-2)] sm:text-[20px]">
          One intent. Every wallet. You still sign.
        </p>
        <Lockup layout="horizontal" size={26} />
        <p className="m-0 text-center text-[12px] text-[var(--ot-text-3)]">{BUILT_DURING}</p>
      </footer>
    </div>
  )
}
