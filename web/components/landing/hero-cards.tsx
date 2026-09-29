'use client'

import { animate, motion, useMotionValue, useReducedMotion, useTransform } from 'motion/react'
import { useEffect, useState } from 'react'
import { Otto, type PoseName } from '@/components/brand'
import { INTENT_PROMPTS } from '@/components/shell/prompts'
import { cn } from '@/lib/cn'
import { EXAMPLE } from './story-script'
import { useFit } from './use-fit'

/**
 * The hero's right half: Otto in the water with the three things he does
 * for a stock buy, arriving in order. The prompt types itself, the stock he
 * picked surfaces, the review he hands back settles in front of him, and he
 * changes pose with each. After that everything only bobs.
 *
 * The prompt is the app's own lead intent, so the landing page and the
 * nudge inside the product say the same first thing.
 */
export const HERO_PROMPT = INTENT_PROMPTS[0]!

const W = 540
const H = 520

/** When each card lands, in seconds after mount. Otto's pose follows. */
const CUES: readonly { at: number; pose: PoseName }[] = [
  { at: 0.3, pose: 'planning' },
  { at: 2.1, pose: 'simulating' },
  { at: 3.1, pose: 'plan-ready' },
]

export function HeroCards({ className }: { className?: string }) {
  const reduce = useReducedMotion()
  const { ref, scale } = useFit<HTMLDivElement>(W)
  const [pose, setPose] = useState<PoseName>('base')

  const typed = useMotionValue(reduce ? HERO_PROMPT.length : 0)
  const text = useTransform(typed, (n) => HERO_PROMPT.slice(0, Math.round(n)))

  useEffect(() => {
    if (reduce) return
    const typing = animate(typed, HERO_PROMPT.length, { duration: 1.4, delay: 0.5, ease: 'linear' })
    const timers = CUES.map((cue) => setTimeout(() => setPose(cue.pose), cue.at * 1000))
    return () => {
      typing.stop()
      timers.forEach(clearTimeout)
    }
  }, [reduce, typed])

  const card = (delay: number) =>
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
        <div className="ot-drift absolute" style={{ left: 150, top: 130 }}>
          <Otto pose={reduce ? 'plan-ready' : pose} size={260} animated className="h-[260px] w-[260px]" />
        </div>

        <motion.div {...card(0.2)} className="absolute" style={{ left: 0, top: 10, width: 350 }}>
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

        <motion.div {...card(2.0)} className="absolute" style={{ left: 330, top: 134, width: 210 }}>
          <div className="ot-bob ot-bob--b flex flex-col gap-2.5 rounded-[20px] border border-[var(--ot-border)] bg-[color-mix(in_srgb,var(--ot-card)_94%,transparent)] p-3.5 shadow-[0_18px_44px_-16px_rgba(22,33,62,.3)] backdrop-blur-sm">
            <span className="flex items-center gap-2.5">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/stocks/bstock.svg" alt="" width={30} height={30} className="rounded-[8px]" />
              <span className="flex flex-col">
                <span className="font-mono text-[14px] font-semibold">NVDAB</span>
                <span className="text-[11px] text-[var(--ot-text-3)]">bStock · NVIDIA</span>
              </span>
            </span>
            <svg viewBox="0 0 180 40" className="h-10 w-full">
              <line x1="0" y1="20" x2="180" y2="20" stroke="var(--ot-border-strong)" strokeDasharray="3 4" />
              <path d="M0 30 L20 26 L40 28 L60 18 L80 22 L100 14 L120 16 L140 8 L160 12 L180 6" fill="none" stroke="var(--ot-ok)" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span className="flex justify-between text-[12px]">
              <span className="text-[var(--ot-text-3)]">vs share price</span>
              <span className="font-mono font-semibold text-[var(--ot-ok-text)]">{EXAMPLE.premium}</span>
            </span>
          </div>
        </motion.div>

        <motion.div {...card(3.0)} className="absolute" style={{ left: 30, top: 380, width: 410 }}>
          <div className="ot-bob ot-bob--c flex flex-col gap-3 rounded-[20px] border border-[var(--ot-border)] bg-[color-mix(in_srgb,var(--ot-card)_96%,transparent)] p-4 shadow-[0_18px_44px_-16px_rgba(22,33,62,.3)] backdrop-blur-sm">
            <span className="font-display text-[18px] font-bold">
              {EXAMPLE.pay} → {EXAMPLE.get}
            </span>
            <span className="flex gap-3.5 text-[13px] text-[var(--ot-text-2)]">
              {['Decoded', 'Simulated', 'Market open'].map((label) => (
                <span key={label} className="flex items-center gap-1.5">
                  <span className="flex h-[18px] w-[18px] items-center justify-center rounded-full bg-[var(--ot-ok-bg)] text-[var(--ot-ok-text)]">
                    <svg viewBox="0 0 16 16" className="h-2.5 w-2.5" fill="none" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round">
                      <path d="M3.5 8.5l3 3 6-7" />
                    </svg>
                  </span>
                  {label}
                </span>
              ))}
            </span>
            <span className="flex items-center justify-between">
              <span className="flex items-center gap-2 text-[13px] text-[var(--ot-text-3)]">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/wallets/binance_wallet.svg" alt="" width={18} height={18} className="rounded-full" />
                Binance Wallet
              </span>
              <span className="rounded-full bg-[var(--ot-coral)] px-5 py-2 text-[14px] font-semibold text-[var(--ot-on-state)]">Sign</span>
            </span>
          </div>
        </motion.div>
      </div>
    </div>
  )
}
