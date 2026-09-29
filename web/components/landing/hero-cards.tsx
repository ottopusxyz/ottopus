'use client'

import { AnimatePresence, animate, motion, useMotionValue, useReducedMotion, useTransform } from 'motion/react'
import { useEffect, useState, type ReactNode } from 'react'
import { Otto, type PoseName } from '@/components/brand'
import { cn } from '@/lib/cn'
import { EXAMPLE } from './story-script'
import { useFit } from './use-fit'

/**
 * The hero's right half: Otto in the water, doing a stock buy in front of
 * you. The prompt types itself; then a deck of flash cards beside him shows
 * each thing he works out — the stock, the wallet, the route, the simulation.
 * As each is done it shrinks and flies down into its slot on the review
 * below, which fills in from Otto's work and, with the last card, turns solid
 * and offers Sign. It holds, and runs again.
 *
 * The prompt is the intro film's, and the rest of the page follows the same
 * ten dollars of Tesla, so every figure on it agrees. With reduced motion the
 * finished state simply stands: the last card and the review.
 */
export const HERO_PROMPT = EXAMPLE.prompt

const W = 540
const H = 520

/** The deck, in the order Otto works. Otto's pose follows the card on top. */
const STEPS: readonly { key: string; pose: PoseName }[] = [
  { key: 'stock', pose: 'planning' },
  { key: 'wallet', pose: 'planning' },
  { key: 'route', pose: 'planning' },
  { key: 'simulate', pose: 'simulating' },
]

/** Seconds: when the deck starts, how long each card stays, how long the result holds. */
const DECK_AT = 2.1
const CARD_S = 1.35
const HOLD_S = 5.5

/** -1 before the deck, 0..3 a card on top, STEPS.length once the review is in. */
type Phase = number
const DONE = STEPS.length

/** Where the deck and the review sit in the 540×520 drawing. */
const DECK = { x: 318, y: 118, w: 222, h: 178 }
const REVIEW = { x: 30, y: 372, w: 410 }

/** The middle of the slot each card lands in on the review, in the drawing's coordinates. */
const SLOTS: Record<string, { x: number; y: number }> = {
  stock: { x: 300, y: 426 },
  simulate: { x: 190, y: 460 },
  wallet: { x: 110, y: 496 },
  route: { x: 240, y: 496 },
}

/** A finished card's exit: shrink and fly into its slot, arriving as the slot fills. */
function flightTo(step: string) {
  const to = SLOTS[step]!
  return {
    x: to.x - (DECK.x + DECK.w / 2),
    y: to.y - (DECK.y + DECK.h / 2),
    scale: 0.12,
    rotate: -10,
    opacity: 0,
    transition: { duration: 0.55, ease: [0.45, 0, 0.2, 1] as const },
  }
}

/** How long after a card leaves the deck its slot lights up: the flight's length, near enough. */
const LAND_S = 0.45

export function HeroCards({ className }: { className?: string }) {
  const reduce = useReducedMotion()
  const { ref, scale } = useFit<HTMLDivElement>(W)
  const [phase, setPhase] = useState<Phase>(-1)

  const typed = useMotionValue(reduce ? HERO_PROMPT.length : 0)
  const text = useTransform(typed, (n) => HERO_PROMPT.slice(0, Math.round(n)))

  useEffect(() => {
    if (reduce) return
    const typing = animate(typed, HERO_PROMPT.length, { duration: 1.4, delay: 0.5, ease: 'linear' })
    let timer: ReturnType<typeof setTimeout>
    // One clock for the whole loop: each card, then the review, then a hold,
    // then back to the first card. The prompt stays typed after the first run.
    const run = (p: Phase) => {
      setPhase(p)
      const wait = p === DONE ? HOLD_S : CARD_S
      timer = setTimeout(() => run(p === DONE ? 0 : p + 1), wait * 1000)
    }
    timer = setTimeout(() => run(0), DECK_AT * 1000)
    return () => {
      typing.stop()
      clearTimeout(timer)
    }
  }, [reduce, typed])

  const shown: Phase = reduce ? DONE : phase
  const top = Math.min(Math.max(shown, 0), STEPS.length - 1)
  const pose: PoseName = shown < 0 ? 'base' : shown === DONE ? 'plan-ready' : STEPS[top]!.pose

  const enter = (delay: number) =>
    reduce
      ? {}
      : {
          initial: { opacity: 0, y: 18, scale: 0.96 },
          animate: { opacity: 1, y: 0, scale: 1 },
          transition: { delay, type: 'spring' as const, stiffness: 140, damping: 18 },
        }

  return (
    <div ref={ref} aria-hidden className={cn('relative', className)} style={{ aspectRatio: `${W} / ${H}` }}>
      {/* Absolute, so the design width never becomes the column's minimum. */}
      <div className="absolute top-0 left-0" style={{ width: W, height: H, transform: `scale(${scale})`, transformOrigin: '0 0' }}>
        <div className="ot-drift absolute" style={{ left: 130, top: 140 }}>
          <Otto pose={pose} size={250} animated className="h-[250px] w-[250px]" />
        </div>

        <motion.div {...enter(0.2)} className="absolute" style={{ left: 0, top: 10, width: 350 }}>
          <div className="ot-bob flex flex-col gap-2.5 rounded-[20px] border border-[var(--ot-border)] bg-[color-mix(in_srgb,var(--ot-card)_94%,transparent)] px-4 py-3.5 shadow-[0_18px_44px_-16px_rgba(22,33,62,.3)] backdrop-blur-sm">
            <span className="flex items-center gap-2 text-[11px] font-semibold tracking-[0.06em] text-[var(--ot-text-3)] uppercase">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/agents/claude-ai.svg" alt="" width={18} height={18} />
              Your agent
            </span>
            <span className="self-end rounded-[14px] rounded-br-[4px] bg-[var(--ot-coral-soft)] px-3 py-2 text-[15px] font-semibold text-[var(--ot-coral-text)]">
              <motion.span>{text}</motion.span>
              <span className="ml-px inline-block h-[1em] w-[2px] translate-y-[0.15em] bg-[var(--ot-coral)] motion-safe:animate-pulse" />
            </span>
          </div>
        </motion.div>

        {/* The deck. Two blank cards stand behind it so it reads as a stack.
            A finished card does not leave: it shrinks and flies down into its
            slot on the review below, which is built out of Otto's work. */}
        {shown >= 0 ? (
          <div className="absolute" style={{ left: DECK.x, top: DECK.y, width: DECK.w, height: DECK.h }}>
            <motion.span
              className="absolute inset-0 translate-x-[10px] translate-y-[12px] rotate-[5deg] rounded-[20px] border border-[var(--ot-border)] bg-[var(--ot-surface-2)]"
              animate={{ opacity: shown === DONE ? 0 : 0.7 }}
            />
            <motion.span
              className="absolute inset-0 translate-x-[5px] translate-y-[6px] rotate-[2.5deg] rounded-[20px] border border-[var(--ot-border)] bg-[var(--ot-card)]"
              animate={{ opacity: shown === DONE ? 0 : 0.9 }}
            />
            <AnimatePresence initial={false}>
              {shown < DONE ? (
                <motion.div
                  key={STEPS[top]!.key}
                  className="absolute inset-0"
                  initial={{ y: 12, scale: 0.94, rotate: 2.5, opacity: 0.6 }}
                  animate={{ y: 0, scale: 1, rotate: 0, opacity: 1 }}
                  exit={flightTo(STEPS[top]!.key)}
                  transition={{ type: 'spring', stiffness: 170, damping: 20 }}
                >
                  <DeckCard step={STEPS[top]!.key} n={top + 1} />
                </motion.div>
              ) : null}
            </AnimatePresence>
          </div>
        ) : null}

        <AnimatePresence>
          {shown >= 0 ? (
            <motion.div
              key="review"
              className="absolute"
              style={{ left: REVIEW.x, top: REVIEW.y, width: REVIEW.w }}
              initial={reduce ? false : { opacity: 0, y: 24, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 16, scale: 0.97 }}
              transition={{ type: 'spring', stiffness: 140, damping: 18 }}
            >
              <ReviewCard landed={(step) => shown === DONE || STEPS.findIndex((s) => s.key === step) < shown} ready={shown === DONE} instant={!!reduce} />
            </motion.div>
          ) : null}
        </AnimatePresence>
      </div>
    </div>
  )
}

/* ── the cards ───────────────────────────────────────────────────── */

const CAPTION = 'text-[10px] font-semibold tracking-[0.08em] text-[var(--ot-text-3)] uppercase'

function Mark({ src, size = 18, round = false, tile = false }: { src: string; size?: number; round?: boolean; tile?: boolean }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt="" width={size} height={size} className={cn('flex-none', round ? 'rounded-full' : 'rounded-[5px]', tile && 'bg-[var(--ot-cream)]')} />
  )
}

function TeslaMark({ size = 20 }: { size?: number }) {
  return (
    <span className="flex flex-none items-center justify-center rounded-full bg-[#E31937]" style={{ width: size, height: size }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/brands/tesla.svg" alt="" width={size * 0.6} height={size * 0.6} />
    </span>
  )
}

function Tick() {
  return (
    <span className="flex h-[18px] w-[18px] flex-none items-center justify-center rounded-full bg-[var(--ot-ok-bg)] text-[var(--ot-ok-text)]">
      <svg viewBox="0 0 16 16" className="h-2.5 w-2.5" fill="none" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round">
        <path d="M3.5 8.5l3 3 6-7" />
      </svg>
    </span>
  )
}

/** One row of a card: the picked one is lit, the rest recede. */
function Option({ picked = false, children }: { picked?: boolean; children: ReactNode }) {
  return (
    <div
      className={cn(
        'flex items-center gap-2 rounded-[10px] px-2 py-1.5 text-[12.5px]',
        picked ? 'bg-[var(--ot-ok-bg)] font-semibold ring-1 ring-[var(--ot-ok-border)]' : 'text-[var(--ot-text-3)] opacity-70',
      )}
    >
      {children}
    </div>
  )
}

function DeckCard({ step, n }: { step: string; n: number }) {
  const titles: Record<string, string> = {
    stock: 'Finding the stock',
    wallet: 'Picking the wallet',
    route: 'Picking the route',
    simulate: 'Simulating it',
  }
  return (
    <div className="flex h-full flex-col gap-2.5 rounded-[20px] border border-[var(--ot-border)] bg-[var(--ot-card)] p-3.5 shadow-[0_18px_44px_-16px_rgba(22,33,62,.3)]">
      <div className="flex items-center justify-between">
        <span className={CAPTION}>{titles[step]}</span>
        <span className="font-mono text-[10px] text-[var(--ot-text-4)]">{n}/4</span>
      </div>
      {step === 'stock' ? (
        <div className="flex flex-col gap-1">
          <Option picked>
            <TeslaMark size={18} />
            <span className="font-mono">TSLAB</span>
            <Mark src="/stocks/bstock.svg" size={13} />
            <span className="ml-auto font-mono text-[11px] text-[var(--ot-ok-text)]">{EXAMPLE.premium}</span>
          </Option>
          <Option>
            <TeslaMark size={18} />
            <span className="font-mono">TSLAon</span>
            <Mark src="/stocks/ondo.svg" size={13} tile />
            <span className="ml-auto font-mono text-[11px]">+0.31%</span>
          </Option>
          <Option>
            <TeslaMark size={18} />
            <span className="font-mono">TSLAx</span>
            <span className="ml-auto text-[11px]">no market data</span>
          </Option>
        </div>
      ) : step === 'wallet' ? (
        <div className="flex flex-col gap-2.5">
          <div className="flex items-center gap-1.5">
            {['/wallets/metamask.svg', '/wallets/ledger.svg', '/wallets/safe.svg', '/wallets/rabby_wallet.svg'].map((src) => (
              <span key={src} className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--ot-surface-2)] opacity-40 grayscale">
                <Mark src={src} size={22} />
              </span>
            ))}
            <span className="flex h-9 w-9 items-center justify-center rounded-full ring-[3px] ring-[#F0B90B]">
              <Mark src="/wallets/binance_wallet.svg" size={30} round />
            </span>
          </div>
          <div className="flex items-start gap-2 text-[12.5px] leading-[1.4]">
            <Tick />
            <span>
              <b>Binance Wallet</b>
              <span className="block text-[var(--ot-text-3)]">{EXAMPLE.holds}</span>
            </span>
          </div>
        </div>
      ) : step === 'route' ? (
        <div className="flex flex-col gap-1">
          <Option picked>
            <Mark src="/dapps/pancakeswap.png" size={18} />
            <span>{EXAMPLE.route}</span>
            <span className="ml-auto font-mono text-[11px] text-[var(--ot-ok-text)]">best</span>
          </Option>
          <span className="flex items-center gap-1.5 px-2 text-[11px] text-[var(--ot-text-3)]">
            <Mark src="/wallets/binance_wallet.svg" size={12} round />
            {EXAMPLE.via} · fee {EXAMPLE.fee}
          </span>
          <Option>
            <span className="flex h-[18px] w-[18px] items-center justify-center rounded-[5px] bg-[var(--ot-surface-3)] text-[9px] font-bold">Li</span>
            <span>LI.FI</span>
            <span className="ml-auto text-[11px]">fallback</span>
          </Option>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between text-[12.5px]">
            <span className="flex items-center gap-1.5"><Mark src="/chains/bnb.svg" size={18} round />BNB</span>
            <span className="font-mono font-semibold text-[var(--ot-block-text)]">−0.0131</span>
          </div>
          <div className="flex items-center justify-between text-[12.5px]">
            <span className="flex items-center gap-1.5"><TeslaMark size={18} />TSLAB</span>
            <span className="font-mono font-semibold text-[var(--ot-ok-text)]">+0.0270</span>
          </div>
          <div className="mt-1 flex items-center gap-1.5 text-[11.5px] text-[var(--ot-ok-text)]">
            <Tick />
            Simulated by someone other than the router
          </div>
        </div>
      )}
    </div>
  )
}

/** The review's three checks, each with its own mark, in the ok tone. An open market is a live dot. */
const REVIEW_CHECKS: readonly { label: string; icon: string | null }[] = [
  { label: 'Decoded', icon: 'M5 4 2 8l3 4M11 4l3 4-3 4' },
  { label: 'Simulated', icon: 'M2 12l4-4 3 3 5-6' },
  { label: 'Market open', icon: null },
]

/**
 * A slot on the review: an empty bar until its card lands, then the value,
 * with a small pop and a flash of green as it arrives.
 */
function Slot({ landed, instant, width, children }: { landed: boolean; instant: boolean; width: number; children: ReactNode }) {
  return (
    <AnimatePresence mode="wait" initial={false}>
      {landed ? (
        <motion.span
          key="value"
          className="flex items-center gap-1.5 rounded-[8px]"
          initial={instant ? false : { scale: 0.7, opacity: 0, backgroundColor: 'rgba(31,181,122,0.28)' }}
          animate={{ scale: 1, opacity: 1, backgroundColor: 'rgba(31,181,122,0)' }}
          transition={{ delay: LAND_S, type: 'spring', stiffness: 260, damping: 18, backgroundColor: { delay: LAND_S + 0.1, duration: 0.8 } }}
        >
          {children}
        </motion.span>
      ) : (
        <motion.span
          key="empty"
          className="block h-[18px] rounded-full bg-[var(--ot-surface-3)]"
          style={{ width }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { delay: LAND_S - 0.1, duration: 0.1 } }}
        />
      )}
    </AnimatePresence>
  )
}

function ReviewCard({ landed, ready, instant }: { landed: (step: string) => boolean; ready: boolean; instant: boolean }) {
  return (
    <div
      className={cn(
        'ot-bob ot-bob--c flex flex-col gap-3 rounded-[20px] border p-4 backdrop-blur-sm transition-[background-color,border-color,box-shadow] duration-500',
        ready
          ? 'border-[var(--ot-border)] bg-[color-mix(in_srgb,var(--ot-card)_96%,transparent)] shadow-[0_18px_44px_-16px_rgba(22,33,62,.3)]'
          : 'border-dashed border-[var(--ot-border-strong)] bg-[color-mix(in_srgb,var(--ot-card)_70%,transparent)] shadow-none',
      )}
    >
      <span className="text-[10px] font-semibold tracking-[0.08em] text-[var(--ot-text-3)] uppercase">
        {ready ? 'Ready to sign' : 'Building your review…'}
      </span>
      <span className="flex h-[24px] items-center gap-2 font-display text-[18px] font-bold">
        <Mark src="/chains/bnb.svg" size={22} round />
        {EXAMPLE.pay}
        <span className="font-ui text-[15px] font-medium text-[var(--ot-text-3)]">→</span>
        <Slot landed={landed('stock')} instant={instant} width={150}>
          <TeslaMark size={22} />
          {EXAMPLE.get}
          <Mark src="/stocks/bstock.svg" size={16} />
        </Slot>
      </span>
      <span className="flex h-[22px] items-center text-[13px] text-[var(--ot-text-2)]">
        <Slot landed={landed('simulate')} instant={instant} width={300}>
          <span className="flex gap-3.5">
            {REVIEW_CHECKS.map((check) => (
              <span key={check.label} className="flex items-center gap-1.5">
                <span className="flex h-[20px] w-[20px] flex-none items-center justify-center rounded-[6px] bg-[var(--ot-ok-bg)] text-[var(--ot-ok-text)]">
                  {check.icon ? (
                    <svg viewBox="0 0 16 16" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round">
                      <path d={check.icon} />
                    </svg>
                  ) : (
                    <span className="h-2 w-2 rounded-full bg-[var(--ot-ok)]" />
                  )}
                </span>
                {check.label}
              </span>
            ))}
          </span>
        </Slot>
      </span>
      <span className="flex h-[36px] items-center justify-between">
        <span className="flex items-center gap-2.5 text-[13px] text-[var(--ot-text-3)]">
          <Slot landed={landed('wallet')} instant={instant} width={112}>
            <Mark src="/wallets/binance_wallet.svg" size={18} round />
            Binance Wallet
          </Slot>
          <span className="h-3.5 w-px bg-[var(--ot-border-strong)]" />
          <Slot landed={landed('route')} instant={instant} width={100}>
            <Mark src="/dapps/pancakeswap.png" size={18} />
            {EXAMPLE.route}
          </Slot>
        </span>
        <AnimatePresence initial={false}>
          {ready ? (
            <motion.span
              key="sign"
              className="rounded-full bg-[var(--ot-coral)] px-5 py-2 text-[14px] font-semibold text-[var(--ot-on-state)]"
              initial={instant ? false : { scale: 0.6, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ delay: LAND_S + 0.25, type: 'spring', stiffness: 300, damping: 16 }}
            >
              Sign
            </motion.span>
          ) : null}
        </AnimatePresence>
      </span>
    </div>
  )
}
