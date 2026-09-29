import type { CSSProperties } from 'react'
import { LandingAccount, SignInCta } from '@/components/auth'
import { Lockup, Otto } from '@/components/brand'
import { AddToAgent } from '@/components/landing/add-to-agent'
import { HeroCards } from '@/components/landing/hero-cards'
import { LandingMotion } from '@/components/landing/landing-motion'
import { Reveal } from '@/components/landing/reveal'
import { Story } from '@/components/landing/story'
import { BubbleField, SeaLife, type SeaCreature } from '@/components/motion'
import { GitHub, REPO_URL } from '@/components/shell'

/**
 * The landing page. The message is the product's first one — stop juggling
 * wallets — told through the case that shows it best: buying a stock, which
 * today takes a token hunt, a bridge, a dapp and three wallet pop-ups.
 *
 * Three parts. The hero is under water, the one place the sea is loud, with
 * Otto and the three things he does for you arriving in turn. Then one pinned
 * story, scrubbed by scroll: the clutter flies into Otto, one sentence goes
 * in, one link comes back and grows into the review, the review splits into
 * its checks, and the two ways a plan ends. Then the close.
 *
 * Outside the app shell on purpose. The brand bar carries the lockup, the
 * repo, and either a greeting that opens the app or a Sign in button.
 */

/** Where this was built. One line above the headline; remove it here and it is gone. */
const BUILT_AT = 'Built at BNB Hack: Tokenized Stocks Edition'

/** Six, the design system's ceiling: past that it reads as an aquarium. */
const HERO_LIFE: readonly SeaCreature[] = [
  { species: 'fish', left: 92, top: 16, size: 24, travel: -180, lift: -12, delay: 0, duration: 60, opacity: 0.85 },
  { species: 'fish', left: 56, top: 30, size: 15, travel: 140, lift: 10, delay: 22, duration: 70, opacity: 0.6 },
  { species: 'jelly', left: 96, top: 56, size: 26, travel: 10, lift: -140, delay: 6, duration: 54, opacity: 0.75 },
  { species: 'jelly', left: 48, top: 64, size: 16, travel: -8, lift: -100, delay: 28, duration: 62, opacity: 0.5 },
  { species: 'turtle', left: 30, top: 86, size: 34, travel: 240, lift: -18, delay: 12, duration: 88, opacity: 0.75 },
  { species: 'crab', left: 14, top: 97, size: 22, travel: 110, lift: 0, delay: 3, duration: 46, opacity: 0.85 },
]

/** The column of bubbles rising behind Otto: left %, size px, delay s. */
const RISE: readonly [number, number, number][] = [
  [74, 12, 0],
  [76, 7, 2.4],
  [72, 9, 5.1],
  [79, 14, 7.3],
  [70, 6, 9.2],
]

/** Light from the surface, slanting in over the right half. */
const SHAFTS: readonly [string, number, string][] = [
  ['52%', 150, '14deg'],
  ['68%', 90, '10deg'],
  ['84%', 180, '17deg'],
]

const PROMISES = [
  { title: 'Never signs', body: 'You do, or your agent’s wallet does.' },
  { title: 'Never sends', body: 'It prepares a plan. That is all.' },
  { title: 'Open source', body: 'Read every line on GitHub.' },
]

export default function Landing() {
  return (
    <LandingMotion>
      <div className="flex min-h-dvh flex-col">
        {/* The brand bar: navy ground, cream lockup, a cream hairline. Navy and
            cream do not move between themes, so it is identical in both. The
            coral line under it fills as the page is read, where supported. */}
        <header
          className={
            'sticky top-0 z-50 flex flex-wrap items-center justify-between gap-x-4 gap-y-2.5 ' +
            'border-b border-[rgba(255,240,220,0.14)] bg-[var(--ot-navy)] px-5 py-[14px] sm:px-8'
          }
        >
          <Lockup layout="horizontal" tone="reversed" size={30} />
          <div className="flex items-center gap-1.5">
            <a
              href="#how"
              className="hidden h-9 items-center rounded-full px-3 text-[13px] font-medium text-[var(--ot-cream)] transition-colors hover:bg-[rgba(255,240,220,0.1)] sm:inline-flex"
            >
              How it works
            </a>
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
          {/* Hero, under water. The sea stays out from under the words: the
              shafts, the rising column and the creatures keep to the right
              half and the seabed. */}
          <section className="ot-land-sea relative overflow-hidden px-5 pt-12 pb-36 sm:px-10 lg:pt-20 lg:pb-44">
            <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
              <div className="ot-caustic" />
              <div className="ot-caustic ot-caustic--b" />
              {SHAFTS.map(([left, width, tilt]) => (
                <span
                  key={left}
                  className="ot-shaft ot-land-shaft"
                  style={{ left, width, height: '120%', '--ot-shaft-tilt': tilt } as CSSProperties}
                />
              ))}
              {RISE.map(([left, size, delay]) => (
                <span key={left} className="ot-land-rise" style={{ left: `${left}%`, width: size, height: size, animationDelay: `${delay}s` }} />
              ))}
              <BubbleField pattern="canvas" />
              <SeaLife creatures={HERO_LIFE} />
              <Seabed />
            </div>

            <div className="relative mx-auto grid w-full max-w-[1200px] items-center gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,540px)]">
              <div className="flex flex-col gap-6">
                <p className="m-0 flex items-center gap-2.5 text-[14px] font-semibold text-[var(--ot-text-2)]">
                  <span aria-hidden className="h-2 w-2 rounded-full bg-[#F3BA2F]" />
                  {BUILT_AT}
                </p>

                <h1 className="font-display m-0 text-[44px] leading-[1.02] font-bold tracking-[-0.035em] text-balance sm:text-[64px]">
                  Stop juggling wallets to buy <span className="text-[var(--ot-coral-text)]">one stock.</span>
                </h1>

                <p className="m-0 max-w-[46ch] text-[18px] leading-[1.5] text-pretty text-[var(--ot-text-2)] sm:text-[20px]">
                  Say &ldquo;buy NVIDIA&rdquo; to your agent. Otto finds the token, the wallet and the
                  route — and checks it all before you sign.
                </p>

                <div className="flex flex-wrap items-center gap-3 pt-1">
                  <SignInCta>Link your first wallet</SignInCta>
                  <AddToAgent />
                </div>
              </div>

              <HeroCards className="mx-auto w-full max-w-[540px]" />
            </div>
          </section>

          <Story />

          {/* The close. Everything moving is over; this is the part to trust. */}
          <section className="relative overflow-hidden bg-[var(--ot-navy)] px-5 py-20 text-[var(--ot-cream)] sm:px-10 sm:py-28">
            <div className="mx-auto grid w-full max-w-[1140px] items-center gap-10 lg:grid-cols-[220px_minmax(0,1fr)] lg:gap-16">
              <Reveal>
                <Otto pose="base" size={220} animated className="mx-auto h-auto w-[160px] lg:w-[220px]" />
              </Reveal>
              <div className="flex flex-col gap-10">
                <Reveal as="h2" className="font-display m-0 text-[40px] leading-[1.04] font-bold tracking-[-0.03em] sm:text-[58px]">
                  Otto never holds a key.
                </Reveal>
                <div className="grid gap-8 sm:grid-cols-3">
                  {PROMISES.map((p, i) => (
                    <Reveal key={p.title} index={i} className="flex flex-col gap-1.5">
                      <span className="font-display text-[22px] font-bold">{p.title}</span>
                      <span className="text-[15px] text-[#BFC7DB]">{p.body}</span>
                    </Reveal>
                  ))}
                </div>
              </div>
            </div>
          </section>
        </main>

        <footer className="flex flex-col gap-8 px-5 py-14 sm:px-10">
          <div className="mx-auto flex w-full max-w-[1140px] flex-wrap items-center justify-between gap-6">
            <p className="font-display m-0 text-[26px] font-bold tracking-[-0.02em] sm:text-[34px]">
              One intent. Every wallet. You still sign.
            </p>
            <SignInCta variant="secondary">Link your first wallet</SignInCta>
          </div>
          <div className="mx-auto flex w-full max-w-[1140px] flex-wrap items-center justify-between gap-4 border-t border-[var(--ot-border)] pt-6">
            <Lockup layout="horizontal" size={26} />
          </div>
        </footer>
      </div>
    </LandingMotion>
  )
}

/** Sand and weed along the bottom of the hero, in the water's own blues. */
function Seabed() {
  const sand = 'color-mix(in srgb, var(--ot-plan) 26%, var(--ot-water-3))'
  const deep = 'color-mix(in srgb, var(--ot-plan) 38%, var(--ot-water-3))'
  const weed = 'color-mix(in srgb, var(--ot-plan) 45%, var(--ot-water-3))'
  return (
    <svg viewBox="0 0 1440 170" preserveAspectRatio="none" className="absolute bottom-0 left-0 h-[120px] w-full sm:h-[170px]">
      <path d="M0 90 C 180 60 320 120 520 96 S 900 50 1100 88 S 1340 120 1440 80 L1440 170 L0 170 Z" fill={sand} />
      <path d="M0 130 C 240 110 420 150 700 128 S 1160 110 1440 136 L1440 170 L0 170 Z" fill={deep} opacity={0.6} />
      <g fill="none" stroke={weed} strokeWidth={6} strokeLinecap="round">
        <path d="M130 120 C 120 90 146 70 132 40 M150 124 C 162 96 140 80 156 56" />
        <path d="M1180 108 C 1170 80 1196 60 1182 26 M1200 112 C 1212 86 1190 70 1206 44 M1222 114 C 1214 96 1232 84 1224 64" />
      </g>
    </svg>
  )
}
