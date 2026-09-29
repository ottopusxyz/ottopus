'use client'

import { motion, useTransform, type MotionValue } from 'motion/react'
import type { ReactNode } from 'react'
import { Otto, OttoBadge } from '@/components/brand'
import { cn } from '@/lib/cn'
import { BEATS, EXAMPLE, T } from './story-script'
import { useFit } from './use-fit'

/**
 * The scroll story's right half: one scene, drawn once at 760×640 and scaled
 * to its column, whose every part is a function of scroll progress. Nothing
 * here keeps time of its own — scroll back and it all runs backwards.
 *
 * The same stage renders the stills (phones, reduced motion) by being handed
 * a progress that never moves.
 */

const W = 760
const H = 640

type P = MotionValue<number>

export function Stage({ progress, beat, className }: { progress: P; beat: number; className?: string }) {
  const { ref: box, scale } = useFit<HTMLDivElement>(W)

  return (
    <div
      ref={box}
      aria-hidden
      className={cn('relative w-full overflow-hidden rounded-[40px] border border-[var(--ot-border)]', className)}
      style={{
        aspectRatio: `${W} / ${H}`,
        background: 'linear-gradient(170deg, var(--ot-water-1) 0%, var(--ot-water-3) 100%)',
      }}
    >
      <div className="absolute top-0 left-0" style={{ width: W, height: H, transform: `scale(${scale})`, transformOrigin: '0 0' }}>
        <SceneOne p={progress} />
        <SceneChat p={progress} />
        <SceneReview p={progress} />
        <SceneChecks p={progress} />
        <SceneEndings p={progress} />
        <StageOtto p={progress} beat={beat} />
      </div>
    </div>
  )
}

/* ── shared bits ─────────────────────────────────────────────────── */

const CARD =
  'absolute box-border rounded-[16px] border border-[var(--ot-border)] bg-[var(--ot-card)] shadow-[0_16px_36px_-14px_rgba(22,33,62,.3)]'

function Mark({ src, size = 18, round = false, tile = false }: { src: string; size?: number; round?: boolean; tile?: boolean }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt=""
      width={size}
      height={size}
      className={cn('flex-none', round ? 'rounded-full' : 'rounded-[5px]', tile && 'bg-[var(--ot-cream)]')}
    />
  )
}

function Tick() {
  return (
    <span className="ml-auto flex h-5 w-5 flex-none items-center justify-center rounded-full bg-[var(--ot-ok-bg)] text-[var(--ot-ok-text)]">
      <svg viewBox="0 0 16 16" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round">
        <path d="M3.5 8.5l3 3 6-7" />
      </svg>
    </span>
  )
}

function Bar({ title, icon }: { title: string; icon?: string }) {
  return (
    <div className="flex items-center gap-1.5 border-b border-[var(--ot-border)] bg-[var(--ot-surface-2)] px-3 py-2 text-[12px] font-semibold text-[var(--ot-text-2)]">
      {icon ? (
        <Mark src={icon} size={16} round />
      ) : (
        <>
          <span className="h-2 w-2 rounded-full bg-[var(--ot-border)]" />
          <span className="h-2 w-2 rounded-full bg-[var(--ot-border)]" />
          <span className="h-2 w-2 rounded-full bg-[var(--ot-border)]" />
        </>
      )}
      <span className="ml-1">{title}</span>
    </div>
  )
}

/* ── 01 · the clutter, gathered into Otto ─────────────────────────── */

/** Where Otto's middle is once he arrives; everything in scene one flies here. */
const HUB = { x: 380, y: 150 }

interface Win {
  x: number
  y: number
  w: number
  h: number
  rot: number
  body: ReactNode
  warn?: boolean
}

const WINDOWS: readonly Win[] = [
  {
    x: 30, y: 40, w: 260, h: 130, rot: -5,
    body: (
      <>
        <Bar title="Token search — “NVIDIA”" />
        <div className="flex flex-col gap-1.5 p-3 text-[13px]">
          {[['NVDA', 'ETF token?'], ['N4B', 'unverified'], ['NVDAx', 'other chain']].map(([s, note]) => (
            <div key={s} className="flex items-center gap-2">
              <span className="font-mono font-semibold">{s}</span>
              <span className="text-[var(--ot-text-3)]">{note}</span>
              <span className="ml-auto font-bold text-[var(--ot-block-text)]">?</span>
            </div>
          ))}
        </div>
      </>
    ),
  },
  {
    x: 320, y: 24, w: 240, h: 84, rot: 4,
    body: (
      <>
        <Bar title="Bridge" />
        <div className="flex flex-col gap-1 p-3 text-[12px]">
          <span className="text-[var(--ot-text-3)]">USDT · Ethereum → BNB Chain</span>
          <span className="font-mono font-semibold">~ 6 min · $3.20 fee</span>
        </div>
      </>
    ),
  },
  {
    x: 490, y: 150, w: 230, h: 96, rot: -3,
    body: (
      <>
        <Bar title="Swap" />
        <div className="flex flex-col gap-2 p-3 text-[12px]">
          <span className="text-[var(--ot-text-3)]">Slippage 0.5% · which route?</span>
          <span className="h-6 rounded-[8px] bg-[var(--ot-surface-3)]" />
        </div>
      </>
    ),
  },
  {
    x: 80, y: 240, w: 240, h: 118, rot: 3,
    body: (
      <>
        <Bar title="MetaMask" icon="/wallets/metamask.svg" />
        <div className="flex flex-col gap-2 p-3 text-[12px]">
          <span className="font-semibold">Switch network?</span>
          <div className="flex gap-1.5">
            <span className="flex-1 rounded-full border border-[var(--ot-border-strong)] py-1.5 text-center">Cancel</span>
            <span className="flex-1 rounded-full bg-[var(--ot-plan-bg)] py-1.5 text-center font-semibold text-[var(--ot-plan-text)]">Switch</span>
          </div>
        </div>
      </>
    ),
  },
  {
    x: 380, y: 320, w: 260, h: 110, rot: -4, warn: true,
    body: (
      <>
        <div className="flex items-center gap-1.5 border-b border-[var(--ot-warn-border)] bg-[var(--ot-warn-bg)] px-3 py-2 text-[12px] font-semibold text-[var(--ot-warn-text)]">
          <Mark src="/wallets/binance_wallet.svg" size={16} round />
          <span className="ml-1">Binance Wallet</span>
        </div>
        <div className="flex flex-col gap-1 p-3 text-[12px]">
          <span className="font-semibold">Approve USDT</span>
          <span className="font-mono text-[var(--ot-warn-text)]">Amount: unlimited</span>
          <span className="text-[var(--ot-text-3)]">Spender 0x1b02…a9c4</span>
        </div>
      </>
    ),
  },
  {
    x: 50, y: 460, w: 230, h: 72, rot: -2,
    body: (
      <>
        <Bar title="Explorer" />
        <div className="p-3 font-mono text-[12px]">0x9f3a…e21c · pending</div>
      </>
    ),
  },
  {
    x: 320, y: 500, w: 210, h: 72, rot: 5,
    body: (
      <>
        <Bar title="Ledger" icon="/wallets/ledger.svg" />
        <div className="p-3 text-[12px]">Confirm on device…</div>
      </>
    ),
  },
]

function FlyWindow({ p, win, i }: { p: P; win: Win; i: number }) {
  // Each leaves a touch later than the one before, so they stream in rather than snap.
  const start = T.gather[0] + i * 0.008
  const range = [start, T.gather[1]]
  const x = useTransform(p, range, [0, HUB.x - (win.x + win.w / 2)])
  const y = useTransform(p, range, [0, HUB.y - (win.y + win.h / 2)])
  const scale = useTransform(p, range, [1, 0.12])
  const rotate = useTransform(p, range, [win.rot, win.rot * 3])
  const opacity = useTransform(p, [start, T.gather[1] - 0.03, T.gather[1]], [1, 0.9, 0])
  return (
    <motion.div
      className={cn(CARD, 'overflow-hidden rounded-[14px]', win.warn && 'border-[var(--ot-warn-border)]')}
      style={{ left: win.x, top: win.y, width: win.w, x, y, scale, rotate, opacity }}
    >
      {win.body}
    </motion.div>
  )
}

const ARMS = [
  { src: '/wallets/rabby_wallet.svg', name: 'Rabby', from: { x: 40, y: 80 } },
  { src: '/wallets/safe.svg', name: 'Team Safe', from: { x: 470, y: 60 } },
  { src: '/wallets/ledger.svg', name: 'Ledger', from: { x: 330, y: 520 } },
  { src: '/wallets/metamask.svg', name: 'MetaMask', from: { x: 70, y: 260 } },
] as const

function ArmCard({ p, arm, i }: { p: P; arm: (typeof ARMS)[number]; i: number }) {
  const to = { x: 230, y: 300 + i * 18 }
  const x = useTransform(p, T.stack, [arm.from.x - to.x, 0])
  const y = useTransform(p, T.stack, [arm.from.y - to.y, 0])
  const rotate = useTransform(p, T.stack, [i % 2 ? 12 : -10, -6 + i * 3])
  const opacity = useTransform(p, [T.stack[0], T.stack[0] + 0.03, T.stack[1]], [0, 1, 0.55 + i * 0.15])
  return (
    <motion.div
      className={cn(CARD, 'flex h-16 w-[300px] items-center gap-3 px-4 text-[15px] font-semibold')}
      style={{ left: to.x, top: to.y, x, y, rotate, opacity }}
    >
      <Mark src={arm.src} size={30} />
      {arm.name}
    </motion.div>
  )
}

function SceneOne({ p }: { p: P }) {
  const opacity = useTransform(p, T.sceneOneOut, [1, 0])
  const armsIn = useTransform(p, [T.stack[1] - 0.03, T.stack[1]], [0, 1])
  const armsY = useTransform(p, [T.stack[1] - 0.03, T.stack[1]], [24, 0])
  const count = useTransform(p, T.gather, [10, 1])
  const rounded = useTransform(count, (v) => Math.round(v))
  const before = useTransform(p, [T.gather[1] - 0.02, T.gather[1]], [1, 0])
  const after = useTransform(p, [T.gather[1] - 0.02, T.gather[1]], [0, 1])

  return (
    <motion.div className="absolute inset-0" style={{ opacity }}>
      {WINDOWS.map((win, i) => (
        <FlyWindow key={i} p={p} win={win} i={i} />
      ))}
      {ARMS.map((arm, i) => (
        <ArmCard key={arm.name} p={p} arm={arm} i={i} />
      ))}

      <motion.div
        className={cn(CARD, 'flex w-[360px] flex-col gap-3.5 rounded-[22px] p-[18px]')}
        style={{ left: 200, top: 380, opacity: armsIn, y: armsY }}
      >
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-semibold tracking-[0.06em] text-[var(--ot-text-3)] uppercase">Your arms</span>
          <span className="font-mono text-[12px] text-[var(--ot-text-3)]">5 of 8</span>
        </div>
        <span className="font-display text-[30px] font-bold tracking-[-0.02em]">$4,812.40</span>
        <div className="flex items-center">
          {['/wallets/metamask.svg', '/wallets/binance_wallet.svg', '/wallets/ledger.svg', '/wallets/safe.svg', '/agents/other.svg'].map((src, i) => (
            <span
              key={src}
              className="flex h-[34px] w-[34px] items-center justify-center overflow-hidden rounded-full border-2 border-[var(--ot-card)] bg-[var(--ot-cream)]"
              style={{ marginLeft: i ? -8 : 0 }}
            >
              <Mark src={src} size={i === 4 ? 20 : 30} round />
            </span>
          ))}
          <span className="ml-3 text-[13px] text-[var(--ot-text-2)]">incl. one your agent runs</span>
        </div>
      </motion.div>

      {/* The click counter rolls down as the tabs go, then reads as the one sentence left. */}
      <div className="absolute right-[30px] bottom-[30px] h-[110px] w-[110px]">
        <motion.div
          className="absolute inset-0 flex flex-col items-center justify-center rounded-full bg-[var(--ot-navy)] text-[var(--ot-cream)]"
          style={{ opacity: before }}
        >
          <motion.span className="font-display text-[40px] leading-none font-bold">{rounded}</motion.span>
          <span className="text-[12px]">clicks</span>
        </motion.div>
        <motion.div
          className="absolute inset-0 flex flex-col items-center justify-center rounded-full bg-[var(--ot-coral)] text-[var(--ot-on-state)]"
          style={{ opacity: after }}
        >
          <span className="font-display text-[40px] leading-none font-bold">1</span>
          <span className="text-[12px] font-semibold">sentence</span>
        </motion.div>
      </div>
    </motion.div>
  )
}

/* ── 02 and 03a · the chat, the tool calls, the link ─────────────── */

const TOOLS = [
  { tool: 'find_stock', text: 'NVDAB · NVDAon · NVDAx compared', icon: null },
  { tool: 'wallet', text: `Binance Wallet holds ${EXAMPLE.holds}`, icon: '/wallets/binance_wallet.svg' },
  { tool: 'route', text: 'Best route on BNB Chain', icon: null },
  { tool: 'verify', text: 'Decoded, simulated, sealed', icon: null },
] as const

function ToolRow({ p, row, i }: { p: P; row: (typeof TOOLS)[number]; i: number }) {
  const at = T.tools[i]!
  const opacity = useTransform(p, [at - 0.02, at], [0, 1])
  const x = useTransform(p, [at - 0.02, at], [-12, 0])
  return (
    <motion.div
      className="flex items-center gap-3 rounded-[14px] bg-[var(--ot-surface-2)] px-3.5 py-3 text-[14px]"
      style={{ opacity, x }}
    >
      <span className="rounded-[6px] bg-[var(--ot-surface-3)] px-1.5 py-0.5 font-mono text-[12px] text-[var(--ot-text-2)]">{row.tool}</span>
      {row.icon ? <Mark src={row.icon} size={18} round /> : null}
      {row.text}
      <Tick />
    </motion.div>
  )
}

function SceneChat({ p }: { p: P }) {
  const opacity = useTransform(p, [T.chatIn[0], T.chatIn[1], T.morph[0], T.morph[0] + 0.04], [0, 1, 1, 0])
  const y = useTransform(p, T.chatIn, [40, 0])
  const toolsOut = useTransform(p, [T.reply[0] - 0.01, T.reply[0] + 0.02], [1, 0])
  const replyIn = useTransform(p, T.reply, [0, 1])
  const replyY = useTransform(p, T.reply, [16, 0])
  const glow = useTransform(p, T.glow, [0, 1])

  return (
    <motion.div className="absolute inset-0" style={{ opacity, y }}>
      <div className={cn(CARD, 'overflow-hidden rounded-[24px]')} style={{ left: 70, top: 60, width: 620, height: 420 }}>
        <div className="flex items-center gap-2 border-b border-[var(--ot-border)] px-[18px] py-3.5">
          <Mark src="/agents/claude-ai.svg" size={22} />
          <span className="text-[14px] font-semibold">Claude</span>
          <span className="ml-auto flex items-center gap-1.5 text-[12px] text-[var(--ot-ok-text)]">
            <span className="h-[7px] w-[7px] rounded-full bg-[var(--ot-ok)]" />
            Ottopus connected
          </span>
        </div>
        <div className="flex flex-col gap-3.5 p-5">
          <div className="self-end rounded-[16px] rounded-br-[4px] bg-[var(--ot-coral-soft)] px-4 py-3 text-[17px] font-semibold text-[var(--ot-coral-text)]">
            Buy NVIDIA with {EXAMPLE.pay}
          </div>
          <motion.div className="flex flex-col gap-2.5" style={{ opacity: toolsOut }}>
            {TOOLS.map((row, i) => (
              <ToolRow key={row.tool} p={p} row={row} i={i} />
            ))}
          </motion.div>
        </div>
      </div>

      <motion.div className="absolute" style={{ left: 92, top: 190, width: 560, opacity: replyIn, y: replyY }}>
        <p className="m-0 max-w-[92%] rounded-[16px] rounded-bl-[4px] bg-[var(--ot-surface-2)] px-4 py-3.5 text-[16px] leading-[1.5]">
          Ready. NVDAB from your Binance Wallet, {EXAMPLE.premium.slice(1)} over the share price. Review and sign:
        </p>
      </motion.div>
      <motion.div
        className="absolute flex items-center gap-3 rounded-[16px] border-2 border-[var(--ot-plan)] bg-[var(--ot-plan-bg)] px-[18px] font-mono text-[16px] font-semibold text-[var(--ot-plan-text)]"
        style={{ left: 92, top: 300, width: 330, height: 52, opacity: replyIn }}
      >
        <motion.span
          className="absolute -inset-2 rounded-[22px] bg-[color-mix(in_srgb,var(--ot-plan)_18%,transparent)]"
          style={{ opacity: glow }}
        />
        <svg viewBox="0 0 16 16" className="relative h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round">
          <path d="M6.5 9.5l3-3M7 4.5l1-1a2.8 2.8 0 0 1 4 4l-1 1M9 11.5l-1 1a2.8 2.8 0 0 1-4-4l1-1" />
        </svg>
        <span className="relative">ottopus.xyz/review/7Kq2…</span>
      </motion.div>

      <div className="absolute bottom-[40px] left-[70px] flex gap-3">
        {['/agents/claude-ai.svg', '/agents/codex.svg', '/agents/other.svg'].map((src) => (
          <span key={src} className="flex h-[52px] w-[52px] items-center justify-center rounded-full border border-[var(--ot-border)] bg-[var(--ot-card)]">
            <Mark src={src} size={26} />
          </span>
        ))}
      </div>
    </motion.div>
  )
}

/* ── 03b · the link grows into the review ───────────────────────── */

/** The review page's frame on the stage, and the link pill it grows out of. */
const PAGE = { x: 50, y: 40, w: 660, h: 560 }
const PILL = { x: 92, y: 300, w: 330, h: 52 }

function SceneReview({ p }: { p: P }) {
  const from = `inset(${PILL.y - PAGE.y}px ${PAGE.x + PAGE.w - PILL.x - PILL.w}px ${PAGE.y + PAGE.h - PILL.y - PILL.h}px ${PILL.x - PAGE.x}px round 16px)`
  const clipPath = useTransform(p, T.morph, [from, 'inset(0px 0px 0px 0px round 24px)'])
  const opacity = useTransform(p, [T.morph[0], T.morph[0] + 0.015, T.split[0], T.split[0] + 0.04], [0, 1, 1, 0])
  const inner = useTransform(p, [T.morph[0] + 0.03, T.morph[1] - 0.02], [0, 1])

  return (
    <motion.div
      className="absolute flex flex-col overflow-hidden border border-[var(--ot-border)] bg-[var(--ot-surface)] shadow-[0_30px_60px_-20px_rgba(22,33,62,.35)]"
      style={{ left: PAGE.x, top: PAGE.y, width: PAGE.w, height: PAGE.h, clipPath, opacity }}
    >
      <div className="flex items-center gap-2 bg-[var(--ot-navy)] px-[18px] py-3">
        <OttoBadge size={24} />
        <span className="font-mono text-[12px] text-[var(--ot-cream)]">ottopus.xyz/review/7Kq2…</span>
        <span className="ml-auto font-mono text-[12px] text-[#BFC7DB]">expires 2:41</span>
      </div>
      <motion.div className="flex flex-1 flex-col gap-[18px] p-6" style={{ opacity: inner }}>
        <div className="flex items-center justify-between">
          <span className="font-display text-[30px] font-bold tracking-[-0.02em]">Buy NVIDIA</span>
          <span className="flex items-center gap-1.5 text-[13px] font-semibold text-[var(--ot-ok-text)]">
            <span className="h-2 w-2 rounded-full bg-[var(--ot-ok)]" />
            Market open
          </span>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5 rounded-[16px] border border-[var(--ot-border)] bg-[var(--ot-card)] p-4">
            <span className="text-[11px] font-semibold tracking-[0.06em] text-[var(--ot-text-3)] uppercase">You pay</span>
            <span className="font-mono text-[22px] font-semibold">{EXAMPLE.pay}</span>
          </div>
          <div className="flex flex-col gap-1.5 rounded-[16px] border border-[var(--ot-border)] bg-[var(--ot-card)] p-4">
            <span className="text-[11px] font-semibold tracking-[0.06em] text-[var(--ot-text-3)] uppercase">You get</span>
            <span className="flex items-center gap-2">
              <Mark src="/stocks/bstock.svg" size={22} />
              <span className="font-mono text-[22px] font-semibold">{EXAMPLE.get}</span>
            </span>
          </div>
        </div>
        <div className="flex flex-col gap-3 rounded-[16px] border border-[var(--ot-border)] bg-[var(--ot-card)] p-4 text-[14px]">
          <div className="flex justify-between"><span className="text-[var(--ot-text-3)]">Share price (reference)</span><span className="font-mono font-semibold">{EXAMPLE.reference}</span></div>
          <div className="flex justify-between"><span className="text-[var(--ot-text-3)]">You pay per share</span><span className="font-mono font-semibold">{EXAMPLE.perShare}</span></div>
          <div className="relative h-2 rounded-full bg-[var(--ot-surface-3)]">
            <span className="absolute inset-y-0 left-0 w-[8%] rounded-full bg-[var(--ot-ok)]" />
            <span className="absolute -top-1 right-0 h-4 w-0.5 bg-[var(--ot-warn)]" />
          </div>
          <div className="flex justify-between font-mono text-[12px]"><span className="font-semibold text-[var(--ot-ok-text)]">{EXAMPLE.premium}</span><span className="text-[var(--ot-warn-text)]">Otto warns at 1%</span></div>
        </div>
        <div className="mt-auto flex items-center justify-between">
          <span className="flex items-center gap-2 text-[14px] text-[var(--ot-text-2)]">
            <Mark src="/wallets/binance_wallet.svg" size={22} round />
            From Binance Wallet — it holds the USDT
          </span>
          <span className="rounded-full bg-[var(--ot-coral)] px-7 py-3 text-[15px] font-semibold text-[var(--ot-on-state)]">Sign</span>
        </div>
      </motion.div>
    </motion.div>
  )
}

/* ── 04 · the review splits into its checks ─────────────────────── */

interface Check {
  key: string
  title: string
  tone: 'plan' | 'ok' | 'warn' | 'coral'
  icon: string
  body: ReactNode
}

const TONES = {
  plan: 'bg-[var(--ot-plan-bg)] text-[var(--ot-plan-text)]',
  ok: 'bg-[var(--ot-ok-bg)] text-[var(--ot-ok-text)]',
  warn: 'bg-[var(--ot-warn-bg)] text-[var(--ot-warn-text)]',
  coral: 'bg-[var(--ot-coral-soft)] text-[var(--ot-coral-text)]',
} as const

const CHECKS: readonly Check[] = [
  {
    key: 'decoded',
    title: 'Decoded',
    tone: 'plan',
    icon: 'M5 4 2 8l3 4M11 4l3 4-3 4',
    body: (
      <>
        <div className="flex flex-col gap-2 text-[13px]">
          <span><span className="mr-2 font-mono text-[var(--ot-text-3)]">1</span>Approve <b>exactly {EXAMPLE.pay}</b></span>
          <span><span className="mr-2 font-mono text-[var(--ot-text-3)]">2</span>Swap USDT → NVDAB, min {EXAMPLE.minGet}</span>
        </div>
        <span className="font-mono text-[11px] text-[var(--ot-text-3)]">never an unlimited approval</span>
      </>
    ),
  },
  {
    key: 'simulated',
    title: 'Simulated',
    tone: 'ok',
    icon: 'M2 12l4-4 3 3 5-6',
    body: (
      <>
        <div className="flex flex-col gap-2 text-[13px]">
          <div className="flex justify-between"><span>USDT</span><span className="font-mono font-semibold text-[var(--ot-block-text)]">−50.00</span></div>
          <div className="flex justify-between"><span className="flex items-center gap-1.5"><Mark src="/stocks/bstock.svg" size={16} />NVDAB</span><span className="font-mono font-semibold text-[var(--ot-ok-text)]">+0.2757</span></div>
        </div>
        <span className="font-mono text-[11px] text-[var(--ot-text-3)]">run by someone other than the router</span>
      </>
    ),
  },
  {
    key: 'heads-up',
    title: 'Heads-up',
    tone: 'warn',
    icon: 'M8 2 1.5 13.5h13zM8 6.5v3M8 11.5v.1',
    body: (
      <>
        <span className="text-[13px] leading-[1.5]">Market closed. Priced against Friday&rsquo;s close — opens Monday 9:30 ET.</span>
        <span className="flex items-center gap-2 text-[12px] font-semibold text-[var(--ot-block-text)]">
          <span className="h-2 w-2 rounded-full bg-[var(--ot-block)]" />A halted stock is blocked outright
        </span>
      </>
    ),
  },
  {
    key: 'sealed',
    title: 'Sealed',
    tone: 'coral',
    icon: 'M3 7h10v7H3zM5.5 7V5a2.5 2.5 0 0 1 5 0v2',
    body: (
      <>
        <span className="font-mono text-[12px] text-[var(--ot-text-2)]">plan 0x9f3a…e21c</span>
        <span className="text-[13px] leading-[1.5]">Change one byte, or wait past three minutes, and it will not sign.</span>
      </>
    ),
  },
]

function CheckPanel({ p, check, i }: { p: P; check: Check; i: number }) {
  const col = i % 2
  const row = Math.floor(i / 2)
  const to = { x: 40 + col * 348, y: 40 + row * 216 }
  const start = T.split[0] + i * 0.012
  const x = useTransform(p, [start, T.split[1]], [PAGE.x + PAGE.w / 2 - 166 - to.x, 0])
  const y = useTransform(p, [start, T.split[1]], [PAGE.y + PAGE.h / 2 - 100 - to.y, 0])
  const scale = useTransform(p, [start, T.split[1]], [0.7, 1])
  const lit = T.lights[i]!
  const opacity = useTransform(p, [start, start + 0.02, lit - 0.02, lit, T.endingsIn[0], T.endingsIn[0] + 0.03], [0, 0.45, 0.45, 1, 1, 0])
  const ring = useTransform(p, [lit - 0.02, lit, lit + 0.03], [0, 1, 0])
  return (
    <motion.div
      className={cn(CARD, 'flex h-[200px] w-[332px] flex-col gap-3 rounded-[20px] p-[18px]', check.tone === 'warn' && 'border-[var(--ot-warn-border)]')}
      style={{ left: to.x, top: to.y, x, y, scale, opacity }}
    >
      <motion.span className="pointer-events-none absolute -inset-[3px] rounded-[22px] ring-2 ring-[var(--ot-plan)]" style={{ opacity: ring }} />
      <div className="flex items-center gap-2.5">
        <span className={cn('flex h-[30px] w-[30px] items-center justify-center rounded-[9px]', TONES[check.tone])}>
          <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
            <path d={check.icon} />
          </svg>
        </span>
        <span className="font-display text-[18px] font-bold">{check.title}</span>
      </div>
      {check.body}
    </motion.div>
  )
}

function SceneChecks({ p }: { p: P }) {
  return (
    <div className="absolute inset-0">
      {CHECKS.map((check, i) => (
        <CheckPanel key={check.key} p={p} check={check} i={i} />
      ))}
    </div>
  )
}

/* ── 05 · the two endings ───────────────────────────────────────── */

function SceneEndings({ p }: { p: P }) {
  const opacity = useTransform(p, T.endingsIn, [0, 1])
  const leftX = useTransform(p, T.endingsIn, [-360, 0])
  const rightX = useTransform(p, T.endingsIn, [360, 0])
  return (
    <motion.div className="absolute inset-0" style={{ opacity }}>
      <motion.div
        className={cn(CARD, 'flex w-[350px] flex-col gap-3.5 rounded-[22px] p-5')}
        style={{ left: 40, top: 110, x: leftX, rotate: -3 }}
      >
        <div className="flex items-center gap-2.5">
          <Mark src="/wallets/binance_wallet.svg" size={30} round />
          <span className="text-[15px] font-semibold">Binance Wallet</span>
          <span className="ml-auto text-[11px] font-semibold tracking-[0.06em] text-[var(--ot-text-3)] uppercase">Sign request</span>
        </div>
        <span className="font-display text-[22px] font-bold">{EXAMPLE.pay} → NVDAB</span>
        <span className="flex items-center gap-2 text-[13px] font-semibold text-[var(--ot-ok-text)]">
          <span className="h-2 w-2 rounded-full bg-[var(--ot-ok)]" />
          Matches your review
        </span>
        <div className="flex gap-2 text-[14px]">
          <span className="flex-1 rounded-full border border-[var(--ot-border-strong)] py-2.5 text-center">Reject</span>
          <span className="flex-1 rounded-full bg-[var(--ot-coral)] py-2.5 text-center font-semibold text-[var(--ot-on-state)]">Sign</span>
        </div>
      </motion.div>
      <motion.span className="absolute text-[14px] text-[var(--ot-text-2)]" style={{ left: 80, top: 390, x: leftX }}>
        In your own wallet, like always.
      </motion.span>

      <motion.div
        className="absolute box-border h-[520px] w-[250px] rounded-[40px] bg-[var(--ot-navy)] p-[9px] shadow-[0_34px_70px_-24px_rgba(22,33,62,.5)]"
        style={{ left: 450, top: 60, x: rightX, rotate: 4 }}
      >
        <div className="flex h-full flex-col gap-3 rounded-[32px] bg-[var(--ot-surface)] px-4 pt-[22px] pb-4">
          <span className="text-[11px] font-semibold tracking-[0.06em] text-[var(--ot-text-3)] uppercase">Agent wallet · your rule</span>
          {[['Per plan', '$50'], ['Per day', '$200']].map(([k, v]) => (
            <div key={k} className="flex justify-between text-[13px]"><span className="text-[var(--ot-text-3)]">{k}</span><span className="font-mono font-semibold">{v}</span></div>
          ))}
          <div className="flex justify-between text-[13px]">
            <span className="text-[var(--ot-text-3)]">Only</span>
            <span className="flex gap-1"><Mark src="/stocks/bstock.svg" size={18} /><Mark src="/stocks/ondo.svg" size={18} tile /></span>
          </div>
          <div className="mt-auto flex flex-col items-center gap-1 rounded-[18px] border border-[var(--ot-ok-border)] bg-[var(--ot-ok-bg)] p-3.5">
            <Otto pose="confirmed" size={70} className="h-[70px] w-[70px]" />
            <span className="text-[14px] font-bold text-[var(--ot-ok-text)]">Approved by your rule</span>
            <span className="font-mono text-[11px] text-[var(--ot-ok-text)]">{EXAMPLE.agentPay} → NVDAB · sent</span>
          </div>
        </div>
      </motion.div>
    </motion.div>
  )
}

/* ── Otto, who moves between the scenes ─────────────────────────── */

function StageOtto({ p, beat }: { p: P; beat: number }) {
  // Centre-top while he gathers the clutter and holds the wallets, bottom-right
  // while the agent works, out of the way while the review page fills the
  // stage, bottom-centre under the checks, gone once the endings take over.
  const x = useTransform(p, [0.24, 0.3, 0.64, 0.66], [270, 560, 560, 295])
  const y = useTransform(p, [0.24, 0.3, 0.64, 0.66], [40, 440, 440, 450])
  const scale = useTransform(p, [0.24, 0.3], [1, 0.75])
  const opacity = useTransform(
    p,
    [0.07, 0.12, T.morph[0] - 0.02, T.morph[0], T.split[0], T.split[0] + 0.04, T.endingsIn[0], T.endingsIn[0] + 0.03],
    [0, 1, 1, 0, 0, 1, 1, 0],
  )
  return (
    <motion.div className="absolute top-0 left-0" style={{ x, y, scale, opacity, transformOrigin: '0 0' }}>
      <Otto pose={BEATS[beat]!.pose} size={220} animated className="h-[220px] w-[220px]" />
    </motion.div>
  )
}
