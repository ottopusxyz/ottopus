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
        <ScenePick p={progress} />
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

const CAPTION = 'text-[11px] font-semibold tracking-[0.06em] text-[var(--ot-text-3)] uppercase'

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

/** Tesla's mark is white, so it sits on Tesla red, as the films draw it. */
function TeslaMark({ size = 22 }: { size?: number }) {
  return (
    <span className="flex flex-none items-center justify-center rounded-full bg-[#E31937]" style={{ width: size, height: size }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/brands/tesla.svg" alt="" width={size * 0.6} height={size * 0.6} />
    </span>
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

/* ── 01 · six tabs and a pile of apps, gathered into Otto ─────────── */

/** Where Otto's middle is once he arrives; everything in scene one flies here. */
const HUB = { x: 380, y: 150 }

const TABS: readonly { url: string; icon?: string }[] = [
  { url: 'web3.binance.com', icon: '/wallets/binance_wallet.svg' },
  { url: 'pancakeswap.finance', icon: '/dapps/pancakeswap.png' },
  { url: 'bstocks.xyz', icon: '/stocks/bstock.svg' },
  { url: 'bscscan.com', icon: '/chains/bnb.svg' },
  { url: 'app.safe.global', icon: '/wallets/safe.svg' },
  { url: 'google.com/search?q=tsla+bnb' },
]

const DECK = { x: 150, y: 120, w: 430, dx: 18, dy: 44 }

/** Wallets and apps around the deck: src, x, y, rotation. */
const TILES: readonly [string, number, number, number][] = [
  ['/wallets/metamask.svg', 40, 40, -8],
  ['/wallets/phantom.svg', 640, 30, 6],
  ['/wallets/rabby_wallet.svg', 30, 250, 7],
  ['/dapps/uniswap.svg', 670, 230, -6],
  ['/wallets/ledger.svg', 40, 470, -4],
  ['/dapps/aave.svg', 660, 430, 5],
  ['/dapps/across.svg', 220, 560, 6],
  ['/dapps/revoke.png', 470, 560, -7],
]

function FlyTab({ p, i }: { p: P; i: number }) {
  const tab = TABS[i]!
  const last = i === TABS.length - 1
  const h = last ? 170 : 150
  const x0 = DECK.x + i * DECK.dx
  const y0 = DECK.y + i * DECK.dy
  const start = T.gather[0] + (TABS.length - 1 - i) * 0.006
  const range = [start, T.gather[1]]
  const x = useTransform(p, range, [0, HUB.x - (x0 + DECK.w / 2)])
  const y = useTransform(p, range, [0, HUB.y - (y0 + h / 2)])
  const scale = useTransform(p, range, [1, 0.1])
  const opacity = useTransform(p, [start, T.gather[1] - 0.02, T.gather[1]], [1, 0.9, 0])
  return (
    <motion.div
      className={cn(CARD, 'overflow-hidden rounded-[14px]')}
      style={{ left: x0, top: y0, width: DECK.w, height: h, x, y, scale, opacity }}
    >
      <div className="flex items-center gap-1.5 border-b border-[var(--ot-border)] bg-[var(--ot-surface-2)] px-3 py-2">
        <span className="h-2 w-2 rounded-full bg-[#F0A0A3]" />
        <span className="h-2 w-2 rounded-full bg-[#F0C36A]" />
        <span className="h-2 w-2 rounded-full bg-[#88D5B0]" />
        <span className="ml-2 flex flex-1 items-center gap-1.5 rounded-[6px] bg-[var(--ot-card)] px-2 py-1 font-mono text-[11px] text-[var(--ot-text-2)]">
          {tab.icon ? <Mark src={tab.icon} size={12} round /> : null}
          {tab.url}
        </span>
      </div>
      {last ? (
        <div className="flex flex-col gap-2 p-3.5">
          <span className="text-[15px] font-semibold">Is this token legit?</span>
          <span className="h-2 w-[86%] rounded-full bg-[var(--ot-surface-3)]" />
          <span className="h-2 w-[70%] rounded-full bg-[var(--ot-surface-3)]" />
          <span className="h-2 w-[78%] rounded-full bg-[var(--ot-surface-3)]" />
        </div>
      ) : null}
    </motion.div>
  )
}

function FlyTile({ p, tile, i }: { p: P; tile: (typeof TILES)[number]; i: number }) {
  const [src, tx, ty, rot] = tile
  const start = T.gather[0] + i * 0.005
  const range = [start, T.gather[1]]
  const x = useTransform(p, range, [0, HUB.x - (tx + 32)])
  const y = useTransform(p, range, [0, HUB.y - (ty + 32)])
  const scale = useTransform(p, range, [1, 0.2])
  const rotate = useTransform(p, range, [rot, rot * 4])
  const opacity = useTransform(p, [start, T.gather[1] - 0.02, T.gather[1]], [1, 0.9, 0])
  return (
    <motion.div
      className="absolute flex h-16 w-16 items-center justify-center overflow-hidden rounded-[16px] border border-[var(--ot-border)] bg-[var(--ot-cream)] shadow-[0_14px_30px_-12px_rgba(22,33,62,.35)]"
      style={{ left: tx, top: ty, x, y, scale, rotate, opacity }}
    >
      <Mark src={src} size={44} />
    </motion.div>
  )
}

const ARMS = [
  { src: '/wallets/rabby_wallet.svg', name: 'Rabby', from: { x: 30, y: 250 } },
  { src: '/wallets/safe.svg', name: 'Team Safe', from: { x: 470, y: 60 } },
  { src: '/wallets/ledger.svg', name: 'Ledger', from: { x: 40, y: 470 } },
  { src: '/wallets/metamask.svg', name: 'MetaMask', from: { x: 40, y: 40 } },
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
  const pill = useTransform(p, [T.gather[0], T.gather[0] + 0.02], [1, 0])
  const armsIn = useTransform(p, [T.stack[1] - 0.03, T.stack[1]], [0, 1])
  const armsY = useTransform(p, [T.stack[1] - 0.03, T.stack[1]], [24, 0])
  const count = useTransform(p, T.gather, [10, 1])
  const rounded = useTransform(count, (v) => Math.round(v))
  const before = useTransform(p, [T.gather[1] - 0.02, T.gather[1]], [1, 0])
  const after = useTransform(p, [T.gather[1] - 0.02, T.gather[1]], [0, 1])

  return (
    <motion.div className="absolute inset-0" style={{ opacity }}>
      {TILES.map((tile, i) => (
        <FlyTile key={tile[0]} p={p} tile={tile} i={i} />
      ))}
      {TABS.map((tab, i) => (
        <FlyTab key={tab.url} p={p} i={i} />
      ))}
      <motion.span
        className="absolute rounded-full bg-[var(--ot-coral)] px-3.5 py-1.5 font-mono text-[14px] font-semibold text-[var(--ot-on-state)] shadow-[0_10px_24px_-10px_rgba(22,33,62,.4)]"
        style={{ left: 520, top: 92, opacity: pill }}
      >
        6 tabs
      </motion.span>

      {ARMS.map((arm, i) => (
        <ArmCard key={arm.name} p={p} arm={arm} i={i} />
      ))}
      <motion.div
        className={cn(CARD, 'flex w-[360px] flex-col gap-3.5 rounded-[22px] p-[18px]')}
        style={{ left: 200, top: 380, opacity: armsIn, y: armsY }}
      >
        <div className="flex items-center justify-between">
          <span className={CAPTION}>Your arms</span>
          <span className="font-mono text-[12px] text-[var(--ot-text-3)]">6 of 8</span>
        </div>
        <span className="font-display text-[30px] font-bold tracking-[-0.02em]">$4,812.40</span>
        <div className="flex items-center">
          {['/wallets/binance_wallet.svg', '/wallets/metamask.svg', '/wallets/ledger.svg', '/wallets/safe.svg', '/wallets/rabby_wallet.svg', '/agents/other.svg'].map(
            (src, i) => (
              <span
                key={src}
                className="flex h-[34px] w-[34px] items-center justify-center overflow-hidden rounded-full border-2 border-[var(--ot-card)] bg-[var(--ot-cream)]"
                style={{ marginLeft: i ? -8 : 0 }}
              >
                <Mark src={src} size={i === 5 ? 20 : 30} round />
              </span>
            ),
          )}
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

/** The review page's frame on the stage, and the link pill it grows out of. */
const PAGE = { x: 50, y: 40, w: 660, h: 560 }
const PILL = { x: 92, y: 300, w: 330, h: 52 }

const TOOLS = [
  { tool: 'find_stock', text: 'TSLAB · TSLAon · TSLAx compared', icon: '/brands/tesla.svg' },
  { tool: 'wallet', text: `${EXAMPLE.walletsChecked} wallets checked`, icon: '/wallets/binance_wallet.svg' },
  { tool: 'route', text: `${EXAMPLE.route} ${EXAMPLE.via}`, icon: '/dapps/pancakeswap.png' },
  { tool: 'verify', text: 'Decoded, simulated, sealed', icon: null },
] as const

function ToolRow({ p, row, i }: { p: P; row: (typeof TOOLS)[number]; i: number }) {
  const at = T.tools[i]!
  const opacity = useTransform(p, [at - 0.015, at], [0, 1])
  const x = useTransform(p, [at - 0.015, at], [-12, 0])
  return (
    <motion.div
      className="flex items-center gap-3 rounded-[14px] bg-[var(--ot-surface-2)] px-3.5 py-3 text-[14px]"
      style={{ opacity, x }}
    >
      <span className="rounded-[6px] bg-[var(--ot-surface-3)] px-1.5 py-0.5 font-mono text-[12px] text-[var(--ot-text-2)]">{row.tool}</span>
      {row.icon === '/brands/tesla.svg' ? <TeslaMark size={18} /> : row.icon ? <Mark src={row.icon} size={18} round /> : null}
      {row.text}
      <Tick />
    </motion.div>
  )
}

const AGENT_MARKS = ['/agents/claude-ai.svg', '/agents/codex.svg', '/agents/openclaw.png', '/agents/other.svg']

function SceneChat({ p }: { p: P }) {
  // Rises for the sentence, steps back while Otto picks the wallet, returns
  // for the reply, and goes as the link grows into the review.
  const opacity = useTransform(
    p,
    [T.chatIn[0], T.chatIn[1], T.pickIn[0], T.pickIn[1], T.pickOut[0], T.pickOut[1], T.morph[0], T.morph[0] + 0.03],
    [0, 1, 1, 0.12, 0.12, 1, 1, 0],
  )
  const y = useTransform(p, T.chatIn, [40, 0])
  const toolsOut = useTransform(p, [T.reply[0] - 0.01, T.reply[0] + 0.015], [1, 0])
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
            {EXAMPLE.prompt}
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
          Ready. TSLAB from your Binance Wallet, {EXAMPLE.premium.slice(1)} over the share price. Review and sign:
        </p>
      </motion.div>
      <motion.div
        className="absolute flex items-center gap-3 rounded-[16px] border-2 border-[var(--ot-plan)] bg-[var(--ot-plan-bg)] px-[18px] font-mono text-[16px] font-semibold text-[var(--ot-plan-text)]"
        style={{ left: PILL.x, top: PILL.y, width: PILL.w, height: PILL.h, opacity: replyIn }}
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
        {AGENT_MARKS.map((src) => (
          <span key={src} className="flex h-[52px] w-[52px] items-center justify-center overflow-hidden rounded-full border border-[var(--ot-border)] bg-[var(--ot-cream)]">
            <Mark src={src} size={26} />
          </span>
        ))}
      </div>
    </motion.div>
  )
}

/* ── 02 · the wallet: six checked, one wins, with its reason ─────── */

const CANDIDATES: readonly { src: string; name: string; note: string; wins?: boolean }[] = [
  { src: '/wallets/metamask.svg', name: 'MetaMask', note: 'no BNB' },
  { src: '/wallets/binance_wallet.svg', name: 'Binance Wallet', note: '0.015 BNB, gas', wins: true },
  { src: '/wallets/ledger.svg', name: 'Ledger', note: 'no BNB' },
  { src: '/wallets/safe.svg', name: 'Team Safe', note: 'too little gas' },
  { src: '/wallets/rabby_wallet.svg', name: 'Rabby', note: 'wrong chain' },
  { src: '/agents/other.svg', name: 'Agent wallet', note: 'outside its rule' },
]

function Candidate({ p, c, i }: { p: P; c: (typeof CANDIDATES)[number]; i: number }) {
  const col = i % 3
  const row = Math.floor(i / 3)
  const settle = T.pickIn[0] + i * 0.004
  const y = useTransform(p, [settle, T.pickIn[1]], [16, 0])
  const opacity = useTransform(p, T.pick, c.wins ? [1, 1] : [1, 0.3])
  const scale = useTransform(p, T.pick, c.wins ? [1, 1.06] : [1, 0.97])
  const ring = useTransform(p, T.pick, [0, c.wins ? 1 : 0])
  return (
    <motion.div
      className={cn(CARD, 'flex h-[96px] w-[168px] flex-col justify-between rounded-[18px] p-3.5')}
      style={{ left: 40 + col * 184, top: 70 + row * 112, y, opacity, scale }}
    >
      <motion.span className="pointer-events-none absolute -inset-[3px] rounded-[20px] ring-[3px] ring-[#F0B90B]" style={{ opacity: ring }} />
      <span className="flex items-center gap-2 text-[14px] font-semibold">
        <Mark src={c.src} size={26} round={c.wins} />
        {c.name}
      </span>
      <span className={cn('font-mono text-[12px]', c.wins ? 'font-semibold text-[var(--ot-ok-text)]' : 'text-[var(--ot-text-3)]')}>{c.note}</span>
    </motion.div>
  )
}

function ScenePick({ p }: { p: P }) {
  const opacity = useTransform(p, [T.pickIn[0], T.pickIn[1], T.pickOut[0], T.pickOut[1]], [0, 1, 1, 0])
  const reason = useTransform(p, T.reason, [0, 1])
  const reasonY = useTransform(p, T.reason, [12, 0])
  return (
    <motion.div className="absolute" style={{ left: 90, top: 60, width: 580, height: 420, opacity }}>
      <span className={cn(CAPTION, 'absolute top-[30px] left-[40px]')}>{EXAMPLE.walletsChecked} wallets checked</span>
      {CANDIDATES.map((c, i) => (
        <Candidate key={c.name} p={p} c={c} i={i} />
      ))}
      <motion.div
        className={cn(CARD, 'flex items-center gap-3 rounded-[16px] px-4 py-3 text-[14px]')}
        style={{ left: 40, top: 310, width: 536, opacity: reason, y: reasonY }}
      >
        <Mark src="/wallets/binance_wallet.svg" size={26} round />
        <span>
          <b>Binance Wallet</b> — {EXAMPLE.holds}.
        </span>
      </motion.div>
    </motion.div>
  )
}

/* ── 03b · the link grows into the review ───────────────────────── */

function SceneReview({ p }: { p: P }) {
  const from = `inset(${PILL.y - PAGE.y}px ${PAGE.x + PAGE.w - PILL.x - PILL.w}px ${PAGE.y + PAGE.h - PILL.y - PILL.h}px ${PILL.x - PAGE.x}px round 16px)`
  const clipPath = useTransform(p, T.morph, [from, 'inset(0px 0px 0px 0px round 24px)'])
  const opacity = useTransform(p, [T.morph[0], T.morph[0] + 0.015, T.split[0], T.split[0] + 0.03], [0, 1, 1, 0])
  const inner = useTransform(p, [T.morph[0] + 0.02, T.morph[1] - 0.01], [0, 1])

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
      <motion.div className="flex flex-1 flex-col gap-4 p-6" style={{ opacity: inner }}>
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-3">
            <TeslaMark size={32} />
            <span className="font-display text-[30px] font-bold tracking-[-0.02em]">Buy Tesla</span>
          </span>
          <span className="flex items-center gap-1.5 text-[13px] font-semibold text-[var(--ot-ok-text)]">
            <span className="h-2 w-2 rounded-full bg-[var(--ot-ok)]" />
            Market open
          </span>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5 rounded-[16px] border border-[var(--ot-border)] bg-[var(--ot-card)] p-4">
            <span className={CAPTION}>You pay</span>
            <span className="flex items-center gap-2">
              <Mark src="/chains/bnb.svg" size={22} round />
              <span className="font-mono text-[21px] font-semibold">{EXAMPLE.pay}</span>
            </span>
            <span className="font-mono text-[12px] text-[var(--ot-text-3)]">≈ {EXAMPLE.payUsd}</span>
          </div>
          <div className="flex flex-col gap-1.5 rounded-[16px] border border-[var(--ot-border)] bg-[var(--ot-card)] p-4">
            <span className={CAPTION}>You get</span>
            <span className="flex items-center gap-2">
              <TeslaMark size={22} />
              <span className="font-mono text-[21px] font-semibold">{EXAMPLE.get}</span>
            </span>
            <span className="flex items-center gap-1.5 text-[12px] text-[var(--ot-text-3)]">
              <Mark src="/stocks/bstock.svg" size={14} />
              bStock · Tesla
            </span>
          </div>
        </div>
        <div className="flex flex-col gap-3 rounded-[16px] border border-[var(--ot-border)] bg-[var(--ot-card)] p-4 text-[14px]">
          <div className="flex justify-between"><span className="text-[var(--ot-text-3)]">Share price (reference)</span><span className="font-mono font-semibold">{EXAMPLE.reference}</span></div>
          <div className="flex justify-between"><span className="text-[var(--ot-text-3)]">You pay per share</span><span className="font-mono font-semibold">{EXAMPLE.perShare}</span></div>
          <div className="relative h-2 rounded-full bg-[var(--ot-surface-3)]">
            <span className="absolute inset-y-0 left-0 w-[19%] rounded-full bg-[var(--ot-ok)]" />
            <span className="absolute -top-1 right-0 h-4 w-0.5 bg-[var(--ot-warn)]" />
          </div>
          <div className="flex justify-between font-mono text-[12px]"><span className="font-semibold text-[var(--ot-ok-text)]">{EXAMPLE.premium}</span><span className="text-[var(--ot-warn-text)]">Otto warns at 1%</span></div>
        </div>
        <div className="flex items-center gap-2 text-[13px] text-[var(--ot-text-2)]">
          <Mark src="/dapps/pancakeswap.png" size={18} />
          {EXAMPLE.route} {EXAMPLE.via} · fee {EXAMPLE.fee}
        </div>
        <div className="mt-auto flex items-center justify-between">
          <span className="flex items-center gap-2 text-[14px] text-[var(--ot-text-2)]">
            <Mark src="/wallets/binance_wallet.svg" size={22} round />
            Binance Wallet — {EXAMPLE.holds}
          </span>
          <span className="rounded-full bg-[var(--ot-coral)] px-7 py-3 text-[15px] font-semibold text-[var(--ot-on-state)]">Sign</span>
        </div>
      </motion.div>
    </motion.div>
  )
}

/* ── 04 · the review splits into its checks ─────────────────────── */

interface CheckSpec {
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

const CHECKS: readonly CheckSpec[] = [
  {
    key: 'decoded',
    title: 'Decoded',
    tone: 'plan',
    icon: 'M5 4 2 8l3 4M11 4l3 4-3 4',
    body: (
      <>
        <div className="flex flex-col gap-2 text-[13px]">
          <span><span className="mr-2 font-mono text-[var(--ot-text-3)]">1</span>Swap <b>{EXAMPLE.pay}</b> → TSLAB, min {EXAMPLE.minGet}</span>
          <span><span className="mr-2 font-mono text-[var(--ot-text-3)]">2</span>Paid to your Binance Wallet, nobody else</span>
        </div>
        <span className="font-mono text-[11px] text-[var(--ot-text-3)]">no token approval needed</span>
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
          <div className="flex justify-between"><span className="flex items-center gap-1.5"><Mark src="/chains/bnb.svg" size={16} round />BNB</span><span className="font-mono font-semibold text-[var(--ot-block-text)]">−0.0131</span></div>
          <div className="flex justify-between"><span className="flex items-center gap-1.5"><TeslaMark size={16} />TSLAB</span><span className="font-mono font-semibold text-[var(--ot-ok-text)]">+0.0270</span></div>
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

function CheckPanel({ p, check, i }: { p: P; check: CheckSpec; i: number }) {
  const col = i % 2
  const row = Math.floor(i / 2)
  const to = { x: 40 + col * 348, y: 40 + row * 216 }
  const start = T.split[0] + i * 0.008
  const x = useTransform(p, [start, T.split[1]], [PAGE.x + PAGE.w / 2 - 166 - to.x, 0])
  const y = useTransform(p, [start, T.split[1]], [PAGE.y + PAGE.h / 2 - 100 - to.y, 0])
  const scale = useTransform(p, [start, T.split[1]], [0.7, 1])
  const lit = T.lights[i]!
  const opacity = useTransform(p, [start, start + 0.015, lit - 0.015, lit, T.endingsIn[0], T.endingsIn[0] + 0.02], [0, 0.45, 0.45, 1, 1, 0])
  const ring = useTransform(p, [lit - 0.015, lit, lit + 0.02], [0, 1, 0])
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

/* ── 05 · the two endings, then the one that landed ──────────────── */

/**
 * The wallet's own confirmation, drawn after the Binance Wallet's dark pop-up
 * so it reads as that wallet at a glance. An illustration of what the wallet
 * shows, captioned as such; its colours are fixed, since the wallet's are.
 */
function WalletPopup() {
  return (
    <div className="flex w-[330px] flex-col gap-3 rounded-[18px] border border-[#2B3139] bg-[#1E2329] p-4 text-[#EAECEF] shadow-[0_28px_60px_-20px_rgba(0,0,0,.6)]">
      <div className="flex items-center gap-2">
        <Mark src="/wallets/binance_wallet.svg" size={22} round />
        <span className="text-[14px] font-semibold">Binance Wallet</span>
        <span className="ml-auto flex items-center gap-1 rounded-full bg-[#2B3139] px-2 py-0.5 text-[11px]">
          <Mark src="/chains/bnb.svg" size={12} round />
          BNB Chain
        </span>
      </div>
      <span className="text-[12px] text-[#848E9C]"><b className="text-[#EAECEF]">ottopus.xyz</b> requests a transaction</span>
      <span className="text-[18px] font-semibold">Swap</span>
      <div className="flex flex-col gap-2 rounded-[12px] bg-[#2B3139] p-3 text-[13px]">
        <div className="flex items-center gap-2">
          <Mark src="/chains/bnb.svg" size={20} round />
          <span className="flex flex-col"><span className="text-[11px] text-[#848E9C]">You pay</span><span className="font-mono font-semibold">−{EXAMPLE.pay}</span></span>
          <span className="ml-auto font-mono text-[12px] text-[#848E9C]">{EXAMPLE.payUsd}</span>
        </div>
        <div className="flex items-center gap-2">
          <TeslaMark size={20} />
          <span className="flex flex-col"><span className="text-[11px] text-[#848E9C]">You receive</span><span className="font-mono font-semibold text-[#2EBD85]">+{EXAMPLE.get}</span></span>
          <span className="ml-auto font-mono text-[12px] text-[#848E9C]">{EXAMPLE.payUsd}</span>
        </div>
      </div>
      <div className="flex justify-between text-[12px]"><span className="text-[#848E9C]">Route</span><span className="flex items-center gap-1"><Mark src="/dapps/pancakeswap.png" size={14} />{EXAMPLE.route}</span></div>
      <div className="flex justify-between text-[12px]"><span className="text-[#848E9C]">Network fee</span><span className="font-mono">{EXAMPLE.fee}</span></div>
      <div className="flex gap-2 text-[14px] font-semibold">
        <span className="flex-1 rounded-[10px] bg-[#2B3139] py-2.5 text-center">Reject</span>
        <span className="flex-1 rounded-[10px] bg-[#FCD535] py-2.5 text-center text-[#181A20]">Confirm</span>
      </div>
    </div>
  )
}

function Milestone({ label, sub }: { label: string; sub: ReactNode }) {
  return (
    <span className="relative flex flex-col items-center gap-1.5">
      <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[#F0B90B] text-[#181A20]">
        <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round">
          <path d="M3.5 8.5l3 3 6-7" />
        </svg>
      </span>
      <span className="text-[11px] font-semibold tracking-[0.08em] uppercase">{label}</span>
      <span className="text-[12px] text-[var(--ot-text-3)]">{sub}</span>
    </span>
  )
}

function SceneEndings({ p }: { p: P }) {
  const opacity = useTransform(p, T.endingsIn, [0, 1])
  const leftX = useTransform(p, T.endingsIn, [-360, 0])
  const rightX = useTransform(p, T.endingsIn, [360, 0])
  // Once it is signed, the pop-up lifts away and the phone steps back: what is
  // left is the transaction landing, and the stock where you keep your stocks.
  const popupOut = useTransform(p, [T.landed[0], T.landed[0] + 0.025], [1, 0])
  const popupY = useTransform(p, [T.landed[0], T.landed[0] + 0.025], [0, -40])
  const phoneOut = useTransform(p, [T.landed[0], T.landed[0] + 0.025], [1, 0])
  // It lands only once the pop-up has gone, so the two never share the frame.
  const landed = useTransform(p, [T.landed[0] + 0.025, T.landed[1]], [0, 1])
  const landedY = useTransform(p, [T.landed[0] + 0.025, T.landed[1]], [30, 0])
  const rail = useTransform(p, [T.landed[0] + 0.01, T.landed[1]], [0, 1])

  return (
    <motion.div className="absolute inset-0" style={{ opacity }}>
      <motion.div className="absolute" style={{ left: 40, top: 70, x: leftX, opacity: popupOut, y: popupY, rotate: -2 }}>
        <WalletPopup />
        <span className="mt-3 block text-center text-[13px] text-[var(--ot-text-2)]">In your own wallet, like always.</span>
      </motion.div>

      <motion.div
        className="absolute box-border h-[520px] w-[250px] rounded-[40px] bg-[var(--ot-navy)] p-[9px] shadow-[0_34px_70px_-24px_rgba(22,33,62,.5)]"
        style={{ left: 450, top: 60, x: rightX, rotate: 4, opacity: phoneOut }}
      >
        <div className="flex h-full flex-col gap-3 rounded-[32px] bg-[var(--ot-surface)] px-4 pt-[22px] pb-4">
          <span className={CAPTION}>Agent wallet · your rule</span>
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
            <span className="font-mono text-[11px] text-[var(--ot-ok-text)]">{EXAMPLE.pay} → TSLAB · sent</span>
          </div>
        </div>
      </motion.div>

      <motion.div className="absolute flex w-[420px] flex-col gap-6" style={{ left: 40, top: 90, opacity: landed, y: landedY }}>
        <div className="relative flex items-start justify-between px-2">
          <span className="absolute top-3.5 right-12 left-12 h-0.5 bg-[var(--ot-border)]" />
          <motion.span className="absolute top-3.5 right-12 left-12 h-0.5 origin-left bg-[#F0B90B]" style={{ scaleX: rail }} />
          <Milestone label="Signed" sub="Binance Wallet" />
          <Milestone label="Confirmed" sub={<span className="text-[var(--ot-plan-text)]">BscScan ↗</span>} />
        </div>
        <div className={cn(CARD, 'relative flex flex-col gap-3 rounded-[20px] p-4')}>
          <div className="flex items-center justify-between">
            <span className={CAPTION}>Your portfolio · BNB Chain</span>
            <span className="rounded-full bg-[var(--ot-ok-bg)] px-2.5 py-0.5 text-[11px] font-semibold text-[var(--ot-ok-text)]">✓ confirmed</span>
          </div>
          <div className="flex items-center gap-3 text-[14px]">
            <Mark src="/chains/bnb.svg" size={28} round />
            <span className="flex flex-col"><span className="font-semibold">BNB</span><span className="text-[12px] text-[var(--ot-text-3)]">BNB Chain</span></span>
            <span className="ml-auto font-mono font-semibold">$204.30</span>
          </div>
          <div className="flex items-center gap-3 rounded-[12px] bg-[var(--ot-ok-bg)] p-2 text-[14px] ring-1 ring-[var(--ot-ok-border)]">
            <TeslaMark size={28} />
            <span className="flex flex-col"><span className="font-semibold">TSLAB</span><span className="text-[12px] text-[var(--ot-text-3)]">Tesla · bStock</span></span>
            <span className="ml-auto font-mono text-[13px] text-[var(--ot-ok-text)]">+0.0270</span>
            <span className="font-mono font-semibold">{EXAMPLE.payUsd}</span>
          </div>
        </div>
      </motion.div>
    </motion.div>
  )
}

/* ── Otto, who moves between the scenes ─────────────────────────── */

function StageOtto({ p, beat }: { p: P; beat: number }) {
  // Centre-top while he gathers the clutter and holds the wallets, bottom-right
  // while the agent works and he picks the wallet, out of the way while the
  // review page fills the stage, bottom-centre under the checks, away for the
  // endings, and back beside the portfolio once it has landed.
  const x = useTransform(p, [0.22, 0.27, 0.64, 0.66, 0.88, 0.9], [270, 560, 560, 295, 295, 490])
  const y = useTransform(p, [0.22, 0.27, 0.64, 0.66, 0.88, 0.9], [40, 440, 440, 450, 450, 230])
  const scale = useTransform(p, [0.22, 0.27, 0.88, 0.9], [1, 0.75, 0.75, 1])
  const opacity = useTransform(
    p,
    [0.05, 0.09, 0.53, 0.55, T.split[0], T.split[1], T.endingsIn[0], T.endingsIn[0] + 0.02, T.landed[0] + 0.025, T.landed[1]],
    [0, 1, 1, 0, 0, 1, 1, 0, 0, 1],
  )
  return (
    <motion.div className="absolute top-0 left-0" style={{ x, y, scale, opacity, transformOrigin: '0 0' }}>
      <Otto pose={BEATS[beat]!.pose} size={220} animated className="h-[220px] w-[220px]" />
    </motion.div>
  )
}
