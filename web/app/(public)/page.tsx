import type { CSSProperties } from 'react'
import Link from 'next/link'
import { LandingAccount, SignInCta } from '@/components/auth'
import { Lockup } from '@/components/brand'
import { HeroDemo } from '@/components/landing/hero-demo'
import { HowItWorks } from '@/components/landing/how-it-works'
import { Reveal } from '@/components/landing/reveal'
import { TypedIntent } from '@/components/landing/typed-intent'
import { BubbleField, SeaLife, type SeaCreature } from '@/components/motion'
import { AssetIcon } from '@/components/portfolio/asset-icon'
import { GitHub, REPO_URL } from '@/components/shell'
import { Badge, IssuerMark, buttonClasses } from '@/components/ui'
import { WALLET_NAMES, walletMark } from '@/components/wallets/naming'

/**
 * The landing page. Tokenized stocks lead, because that is the sharpest case
 * of the product's point: say the stock, and Ottopus works out the token, the
 * wallet and the route, so nobody juggles wallets or hunts for a dapp.
 *
 * The hero is the one place the water is loud, and it stays out from under
 * the words: caustics, bubbles and creatures sit around the demo card, never
 * behind the headline. Everything below carries copy, so it gets entrances on
 * scroll rather than ambient motion.
 *
 * Outside the app shell on purpose. The brand bar carries the lockup, the
 * repo, and either a greeting that opens the app or a Sign in button.
 */

/** Where this was built. One line in the footer; remove it here and it is gone. */
const BUILT_DURING = 'Built during BNB Hack: Tokenized Stocks Edition'

const HERO_LIFE: readonly SeaCreature[] = [
  { species: 'fish', left: 94, top: 12, size: 20, travel: -160, lift: -12, delay: 0, duration: 64, opacity: 0.8 },
  { species: 'turtle', left: 62, top: 90, size: 30, travel: 200, lift: -16, delay: 10, duration: 90, opacity: 0.7 },
  { species: 'jelly', left: 97, top: 62, size: 22, travel: 10, lift: -120, delay: 6, duration: 56, opacity: 0.7 },
  { species: 'fish', left: 54, top: 8, size: 14, travel: -120, lift: 8, delay: 36, duration: 76, opacity: 0.55 },
  { species: 'crab', left: 6, top: 97, size: 20, travel: 90, lift: 0, delay: 3, duration: 46, opacity: 0.8 },
]

/** The chores a stock buy takes today, each struck through as it scrolls in. */
const CLUTTER = [
  'Find which of three tokens is really NVIDIA',
  'Check it is not a lookalike',
  'Work out which wallet has the USDT',
  'Bridge it to the right chain',
  'Find a dapp that lists the token',
  'Approve, swap, and hope you read it right',
]

/** Wallets people sign with, drawn under "You sign". */
const SIGNERS = ['metamask', 'binance_wallet', 'ledger', 'safe', 'rabby_wallet'] as const

export default function Landing() {
  return (
    <div className="flex min-h-dvh flex-col">
      {/* The brand bar: navy ground, cream lockup, a cream hairline underneath.
          Navy and cream do not move between themes, so it is identical in both.
          The coral line under it fills as the page is read, where the browser
          has scroll-driven animations. */}
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
        <span aria-hidden className="ot-scroll-progress absolute inset-x-0 -bottom-px h-[2px] bg-[var(--ot-coral)]" />
      </header>

      <main className="flex flex-1 flex-col">
        {/* Hero. The water lives on this section only, clipped as one layer so
            the caustic sheets never wash past its edge. */}
        <section className="ot-review-sea relative overflow-hidden px-5 pt-10 pb-14 sm:px-10 sm:pt-14 sm:pb-20 lg:pt-28">
          <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
            <div className="ot-caustic" />
            <div className="ot-caustic ot-caustic--b" />
            <BubbleField pattern="canvas" />
            <SeaLife creatures={HERO_LIFE} />
          </div>

          <div className="relative mx-auto grid w-full max-w-[1140px] items-center gap-x-14 gap-y-24 lg:grid-cols-[minmax(0,1fr)_minmax(0,470px)]">
            <div className="flex flex-col gap-5">
              <p className="m-0 flex w-fit flex-wrap items-center gap-x-2 gap-y-1 rounded-[var(--ot-radius-pill)] border border-[var(--ot-border)] bg-[color-mix(in_srgb,var(--ot-card)_75%,transparent)] py-1 pr-3 pl-1 text-[12px] font-medium text-[var(--ot-text-2)] backdrop-blur-sm">
                <Badge tone="coral" className="py-0.5 text-[11px]">New</Badge>
                Tokenized stocks on BNB Chain
                <span className="flex items-center gap-1">
                  <IssuerMark issuer="bstock" ticker="stocks" />
                  <IssuerMark issuer="ondo" ticker="stocks" />
                  <IssuerMark issuer="xstocks" ticker="stocks" />
                </span>
              </p>

              <h1 className="font-display m-0 max-w-[18ch] text-[40px] leading-[1.03] font-bold tracking-[-0.03em] text-pretty sm:text-[58px]">
                Buy the stock, <span className="block text-[var(--ot-coral-text)]">not the token.</span>
              </h1>

              <p className="m-0 max-w-[52ch] text-[17px] leading-[1.55] text-pretty text-[var(--ot-text-2)] sm:text-[18px]">
                Tell your agent &ldquo;put 200 USDT into NVIDIA.&rdquo; Ottopus finds the right stock
                token, the wallet that can pay and the route — no juggling wallets, no hunting for
                dapps — then shows you exactly what will happen before anything moves.
              </p>

              <div className="flex flex-wrap items-center gap-2 pt-1">
                <SignInCta>Link your first wallet</SignInCta>
                <Link href="/review/demo" className={buttonClasses({ variant: 'ghost', size: 'lg' })}>
                  See what a review looks like
                </Link>
              </div>

              <p className="m-0 flex items-center gap-2 text-[13px] text-[var(--ot-text-3)]">
                <svg aria-hidden viewBox="0 0 16 16" className="h-3.5 w-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="7" width="10" height="7" rx="1.5" />
                  <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" />
                </svg>
                Ottopus never holds a key, never signs and never broadcasts.
              </p>
            </div>

            <HeroDemo className="ot-hero-exit mx-auto w-full max-w-[470px] lg:mx-0" />
          </div>
        </section>

        {/* Before and after. The chores are struck through as they arrive. */}
        <section className="border-t border-[var(--ot-border)] px-5 py-16 sm:px-10 sm:py-24">
          <div className="mx-auto grid w-full max-w-[1140px] gap-10 lg:grid-cols-2 lg:gap-16">
            <Reveal className="flex flex-col gap-4">
              <h2 className="font-display m-0 text-[30px] leading-[1.1] font-bold tracking-[-0.025em] sm:text-[40px]">
                One conversation instead of six tabs
              </h2>
              <p className="m-0 max-w-[46ch] text-[16px] leading-[1.6] text-pretty text-[var(--ot-text-2)]">
                The same share comes as bStock, Ondo and xStocks tokens, on different chains, in
                different wallets, on different dapps. Ottopus holds all of that so you do not have to.
              </p>
            </Reveal>

            <div className="flex flex-col gap-6">
              <Reveal as="ul" className="m-0 flex list-none flex-col gap-2.5 p-0">
                {CLUTTER.map((line, i) => (
                  <li key={line} className="flex items-center gap-3 text-[16px] sm:text-[17px]">
                    <span aria-hidden className="font-mono text-[12px] text-[var(--ot-text-4)]">
                      {String(i + 1).padStart(2, '0')}
                    </span>
                    <span className="ot-strike" style={{ '--i': i } as CSSProperties}>
                      {line}
                    </span>
                  </li>
                ))}
              </Reveal>
              <Reveal index={2} className="rounded-[var(--ot-radius-md)] border border-[var(--ot-border)] bg-[var(--ot-card)] p-4 shadow-[var(--ot-shadow-card)]">
                <p className="m-0 mb-1.5 text-[11px] font-semibold tracking-[0.06em] text-[var(--ot-text-3)] uppercase">
                  With Ottopus, say it once
                </p>
                <TypedIntent className="m-0 font-mono text-[15px] text-[var(--ot-text)] sm:text-[16px]" />
              </Reveal>
            </div>
          </div>
        </section>

        {/* How it works, told as you scroll. */}
        <section className="border-t border-[var(--ot-border)] bg-[var(--ot-surface)] px-5 py-16 sm:px-10 sm:py-20">
          <div className="mx-auto w-full max-w-[1140px]">
            <Reveal as="p" className="m-0 mb-2 text-[12px] font-semibold tracking-[0.08em] text-[var(--ot-coral-text)] uppercase">
              How it works
            </Reveal>
            <Reveal as="h2" className="font-display m-0 mb-10 max-w-[22ch] text-[30px] leading-[1.1] font-bold tracking-[-0.025em] sm:text-[40px] lg:mb-0">
              Three steps, and the last one is a sentence
            </Reveal>
            <HowItWorks />
          </div>
        </section>

        {/* Two ways a plan ends. Neither is Ottopus signing. */}
        <section className="border-t border-[var(--ot-border)] px-5 py-16 sm:px-10 sm:py-24">
          <div className="mx-auto flex w-full max-w-[1140px] flex-col gap-10">
            <Reveal className="flex max-w-[60ch] flex-col gap-3">
              <h2 className="font-display m-0 text-[30px] leading-[1.1] font-bold tracking-[-0.025em] sm:text-[40px]">
                You sign, or your agent wallet sends
              </h2>
              <p className="m-0 text-[16px] leading-[1.6] text-pretty text-[var(--ot-text-2)]">
                Every plan is hashed the moment it is built, so what you approve is exactly what runs.
                Change a byte or let it expire, and it will not sign or send.
              </p>
            </Reveal>

            <div className="grid gap-4 md:grid-cols-2">
              <Reveal index={0} className="flex flex-col gap-4 rounded-[var(--ot-radius-lg)] border border-[var(--ot-border)] bg-[var(--ot-card)] p-6 sm:p-7">
                <Badge tone="coral">Review link</Badge>
                <h3 className="font-display m-0 text-[22px] font-bold tracking-[-0.02em]">You sign it</h3>
                <p className="m-0 text-[15px] leading-[1.6] text-[var(--ot-text-2)]">
                  Open the link, read the plan in plain words, check the simulation and the stock&rsquo;s
                  price against its reference, then sign in the wallet you already use.
                </p>
                <ul className="m-0 mt-auto flex list-none flex-wrap gap-2 p-0" aria-label="Wallets you sign with">
                  {SIGNERS.map((type) => (
                    <li key={type} className="flex items-center gap-1.5 text-[12px] text-[var(--ot-text-2)]">
                      <AssetIcon url={walletMark(type)} name={WALLET_NAMES[type] ?? type} size={18} />
                      {WALLET_NAMES[type]}
                    </li>
                  ))}
                </ul>
              </Reveal>

              <Reveal index={1} className="flex flex-col gap-4 rounded-[var(--ot-radius-lg)] border border-[var(--ot-plan-border)] bg-[var(--ot-plan-bg)] p-6 sm:p-7">
                <Badge tone="plan" className="ring-1 ring-[var(--ot-plan-border)]">Agent wallet</Badge>
                <h3 className="font-display m-0 text-[22px] font-bold tracking-[-0.02em]">Your agent sends it</h3>
                <p className="m-0 text-[15px] leading-[1.6] text-[var(--ot-text-2)]">
                  For a wallet your agent runs, approve on the same page — or set a rule once: this much
                  a plan, this much a day, these assets. A plan inside the rule with a passing
                  simulation is approved, and your agent&rsquo;s wallet sends it. Everything else waits
                  for you.
                </p>
                <p className="m-0 mt-auto w-fit rounded-[var(--ot-radius-pill)] bg-[var(--ot-ok-bg)] px-3 py-1.5 text-[12px] font-medium text-[var(--ot-ok-text)] ring-1 ring-[var(--ot-ok-border)]">
                  Approved by your rule for Agent wallet · 20 USDT → NVDAB
                </p>
              </Reveal>
            </div>
          </div>
        </section>

        {/* What gets checked, as a grid of small cards. */}
        <section className="border-t border-[var(--ot-border)] bg-[var(--ot-surface)] px-5 py-16 sm:px-10 sm:py-24">
          <div className="mx-auto flex w-full max-w-[1140px] flex-col gap-10">
            <Reveal as="h2" className="font-display m-0 max-w-[24ch] text-[30px] leading-[1.1] font-bold tracking-[-0.025em] sm:text-[40px]">
              What Otto checks before you ever see it
            </Reveal>

            <div className="grid gap-4 md:grid-cols-6">
              <CheckCard index={0} className="md:col-span-3" title="Is the market open?" body="A halt blocks the plan. A closed market only warns, naming the last close and the next open — on-chain stocks trade around the clock.">
                <div className="flex flex-wrap gap-1.5">
                  <Badge tone="ok">Regular hours</Badge>
                  <Badge tone="plan">Extended hours</Badge>
                  <Badge tone="warn">Closed</Badge>
                  <Badge tone="block">Halted</Badge>
                </div>
              </CheckCard>

              <CheckCard index={1} className="md:col-span-3" title="Is the price fair?" body="What this quote pays per share against the share's reference price. More than 1% the wrong way for you, and Otto says so.">
                <PremiumMeter />
              </CheckCard>

              <CheckCard index={0} className="md:col-span-2" title="Is it the real token?" body="Every issuer's version of a ticker, named and marked, so a lookalike never passes as the real thing.">
                <div className="flex flex-wrap items-center gap-2 font-mono text-[13px]">
                  <span className="flex items-center gap-1.5">NVDAB <IssuerMark issuer="bstock" ticker="NVDA" /></span>
                  <span className="flex items-center gap-1.5">NVDAon <IssuerMark issuer="ondo" ticker="NVDA" /></span>
                  <span className="flex items-center gap-1.5">NVDAx <IssuerMark issuer="xstocks" ticker="NVDA" /></span>
                </div>
              </CheckCard>

              <CheckCard index={1} className="md:col-span-2" title="Does it do what it says?" body="The route comes from one vendor and the simulation from another, so nobody grades their own work.">
                <div className="flex items-center gap-2 text-[12px] font-medium">
                  <span className="rounded-[8px] bg-[var(--ot-surface-3)] px-2.5 py-1.5 text-[var(--ot-text-2)]">Route</span>
                  <span aria-hidden className="h-px flex-1 bg-[var(--ot-border-strong)]" />
                  <span className="rounded-[8px] bg-[var(--ot-ok-bg)] px-2.5 py-1.5 text-[var(--ot-ok-text)]">Simulated elsewhere</span>
                </div>
              </CheckCard>

              <CheckCard index={2} className="md:col-span-2" title="Which wallet, and why?" body="Otto picks the arm that holds the funds on the right chain and tells you the reason, in a sentence.">
                <p className="m-0 flex items-center gap-2 text-[12px] text-[var(--ot-text-2)]">
                  <AssetIcon url={walletMark('binance_wallet')} name="Binance Wallet" size={18} />
                  holds 412 USDT on BNB Chain
                </p>
              </CheckCard>
            </div>
          </div>
        </section>
      </main>

      <footer className="flex flex-col items-center gap-4 border-t border-[var(--ot-border)] px-5 py-10 sm:px-10">
        <p className="font-display m-0 text-center text-[18px] font-semibold tracking-[-0.01em] text-[var(--ot-text-2)] sm:text-[20px]">
          One intent. Every wallet. You still sign.
        </p>
        <Lockup layout="horizontal" size={26} />
        <p className="m-0 flex items-center gap-1.5 text-[12px] text-[var(--ot-text-4)]">
          <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-[#F3BA2F]" />
          {BUILT_DURING}
        </p>
      </footer>
    </div>
  )
}

function CheckCard({
  title,
  body,
  index,
  className,
  children,
}: {
  title: string
  body: string
  index: number
  className?: string
  children: React.ReactNode
}) {
  return (
    <Reveal
      index={index}
      className={
        'flex flex-col gap-3 rounded-[var(--ot-radius-lg)] border border-[var(--ot-border)] bg-[var(--ot-card)] p-6 ' +
        'hover:shadow-[var(--ot-shadow-card)] ' +
        (className ?? '')
      }
    >
      <div className="min-h-[34px]">{children}</div>
      <h3 className="font-display m-0 text-[19px] font-bold tracking-[-0.015em]">{title}</h3>
      <p className="m-0 text-[14px] leading-[1.55] text-pretty text-[var(--ot-text-2)]">{body}</p>
    </Reveal>
  )
}

/** A reference price, this quote, and the 1% line Otto warns past. Illustrative. */
function PremiumMeter() {
  return (
    <div className="flex flex-col gap-1.5" aria-hidden>
      <div className="relative h-2 rounded-full bg-[var(--ot-surface-3)]">
        <span className="absolute inset-y-0 left-[40%] w-[3%] rounded-full bg-[var(--ot-ok)]" />
        <span className="absolute -top-1 bottom-[-4px] left-[40%] w-px bg-[var(--ot-text-2)]" />
        <span className="absolute -top-1 bottom-[-4px] left-[80%] w-px border-l border-dashed border-[var(--ot-warn)]" />
      </div>
      <div className="relative h-4 font-mono text-[11px] text-[var(--ot-text-3)]">
        <span className="absolute left-[40%] -translate-x-1/2">ref</span>
        <span className="absolute left-[43%] translate-x-1 text-[var(--ot-ok-text)]">+0.08%</span>
        <span className="absolute left-[80%] -translate-x-1/2 text-[var(--ot-warn-text)]">1%</span>
      </div>
    </div>
  )
}
