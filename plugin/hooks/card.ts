import type { CapturedPlan } from '../types'
import { explorerOf } from './explorer'

/** What the band draws, as plain words. No element, no surface, no clock of its own. */
export type Card = {
  tone: 'ready' | 'blocked' | 'ended'
  /** Which look the card wears. Finer than the tone: a confirmed plan and an expired one both ended. */
  kind: Kind
  title: string
  summary: string
  /** The wallet, the route and the fees, or why it was refused. Amounts stay on the review page. */
  lines: string[]
  warnings: string[]
  /** When the quote stops holding. Null once that no longer matters. */
  expiresAt: string | null
  /** A paint of its own when the link leaves for a chain's explorer: that chain's colour. */
  link: { href: string; label: string; paint?: { fill: string; ink: string } } | null
}

export type Kind = 'ready' | 'submitted' | 'confirmed' | 'failed' | 'refused' | 'ended'

/** The frames of the one loader, shown while a submitted plan waits on the chain. */
export const SPIN = ['⠲', '⠶', '⠾', '⠻', '⠹', '⠽', '⠵', '⠷'] as const
export const SPIN_MS = 120

/**
 * A colour and a mark for each kind. The colours are the terminal's own
 * names, drawn as text on its background, so they follow the person's theme;
 * the mark and the words carry the status where colour does not. Null is dim.
 */
export const PAINT: Record<Kind, { color: string | null; glyph: string }> = {
  ready: { color: 'blue', glyph: '●' },
  submitted: { color: 'yellow', glyph: SPIN[0] },
  confirmed: { color: 'green', glyph: '✓' },
  // Failed, expired or cancelled: the plan stopped short and will not go through.
  failed: { color: 'red', glyph: '✕' },
  refused: { color: 'red', glyph: '⊘' },
  ended: { color: null, glyph: '–' },
}

/** The loader's frame at a moment. */
export function spinFrame(now: number): string {
  return SPIN[Math.floor(now / SPIN_MS) % SPIN.length]!
}

const URGENT_MS = 30_000

/** True in the last half minute of a quote, when the clock asks to be noticed. */
export function isUrgent(iso: string, now: number): boolean {
  const ms = Date.parse(iso) - now
  return ms > 0 && ms <= URGENT_MS
}

/** Statuses a plan never leaves. Anything else, known or not, is still live. */
const ENDED: Record<string, string> = {
  confirmed: 'Plan confirmed',
  failed: 'Plan failed',
  expired: 'Plan expired',
  superseded: 'Plan replaced',
  cancelled: 'Plan cancelled',
}

const LIVE: Record<string, string> = {
  awaiting_review: 'Plan ready',
  awaiting_signature: 'Plan ready',
  submitted: 'Plan submitted',
}

/** True once nothing more can happen to a plan: there is no point asking again. */
export function isSettled(status: string): boolean {
  return status === 'blocked' || status in ENDED
}

const MAX_LINES = 4

/** `eip155:56:0x1111…1111` reads as a wallet; forty hex characters do not. */
function shortAccount(account: string): string {
  const address = account.split(':').at(-1) ?? account
  return address.length > 13 ? `${address.slice(0, 6)}…${address.slice(-4)}` : address
}

function details(plan: CapturedPlan): string[] {
  const parts = [
    plan.reason?.replace(/\.$/, '') ?? (plan.account ? `Wallet ${shortAccount(plan.account)}` : null),
    plan.route,
    plan.feesUsd ? `~$${plan.feesUsd} fees` : null,
  ].filter((part): part is string => part != null && part !== '')
  // One line, so the band does not grow with the plan.
  return parts.length > 0 ? [parts.join(' · ')] : []
}

/**
 * The card for a plan at a moment, or null when there is nothing to show.
 *
 * A blocked plan shows its reasons and never a link. A plan past its expiry
 * reads as expired even while the stored status still says ready: the card
 * must not invite a signature the review page will refuse. A confirmed plan
 * links to its transaction on the chain's explorer, when the chain is known.
 */
export function cardOf(plan: CapturedPlan | null, now: number): Card | null {
  if (!plan) return null
  if (plan.status === 'blocked') {
    return {
      tone: 'blocked',
      kind: 'refused',
      title: 'Plan refused',
      summary: plan.summary,
      lines: plan.reasons.slice(0, MAX_LINES),
      warnings: [],
      expiresAt: null,
      link: null,
    }
  }
  const link = (label: string) => (plan.reviewUrl ? { href: plan.reviewUrl, label } : null)
  const expiry = plan.expiresAt === null ? Number.NaN : Date.parse(plan.expiresAt)
  const isSubmitted = plan.status === 'submitted'
  const ended = ENDED[plan.status] ?? (!isSubmitted && expiry <= now ? ENDED.expired! : null)
  if (ended) {
    const kind = plan.status === 'confirmed' ? 'confirmed' : plan.status === 'superseded' ? 'ended' : 'failed'
    // A confirmed plan has nothing left to review: its link is the transaction itself.
    const explorer = kind === 'confirmed' ? explorerOf(plan.chainId, plan.txHash) : null
    const out = explorer ? { href: explorer.href, label: 'Open explorer', paint: { fill: explorer.fill, ink: explorer.ink } } : link('Open plan')
    return { tone: 'ended', kind, title: ended, summary: plan.summary, lines: [], warnings: [], expiresAt: null, link: out }
  }
  return {
    tone: 'ready',
    kind: isSubmitted ? 'submitted' : 'ready',
    title: LIVE[plan.status] ?? `Plan ${plan.status.replace(/_/g, ' ')}`,
    summary: plan.summary,
    lines: details(plan),
    warnings: plan.warnings.slice(0, MAX_LINES),
    expiresAt: isSubmitted ? null : plan.expiresAt,
    link: link(isSubmitted ? 'Open plan' : 'Review and sign'),
  }
}

/**
 * How much of a quote's life is left, from 1 down to 0, over the time between
 * when the plan was first seen and its expiry. Null without both ends.
 */
export function lifeLeft(since: number | undefined, iso: string, now: number): number | null {
  const due = Date.parse(iso)
  if (since === undefined || Number.isNaN(due) || due <= since || now >= due) return null
  return Math.min(1, (due - now) / (due - since))
}

/** The same as a whole percent, never 0 while the quote still holds. */
export function shareLeft(since: number | undefined, iso: string, now: number): number | null {
  const life = lifeLeft(since, iso, now)
  return life === null ? null : Math.max(1, Math.ceil(life * 100))
}

export const METER_CELLS = 20

/**
 * A share as a bar that drains: the cells still full, then the empty ones.
 * A fixed width, so it reads the same in a narrow terminal and never wraps.
 * The bar of a surface with no cell grid to paint.
 */
export function meter(share: number): { full: string; rest: string } {
  const full = Math.min(METER_CELLS, Math.max(1, Math.round((share / 100) * METER_CELLS)))
  return { full: '█'.repeat(full), rest: '░'.repeat(METER_CELLS - full) }
}

/**
 * The painted bar's colours, as 0xRRGGBB. A cell grid takes no theme names,
 * so these are the product's own: plan blue, warn amber, ok green.
 */
export const RGB = { plan: 0x5b9bff, warn: 0xf5a524, ok: 0x3ccb8e, glow: 0xeafff5, track: 0x2b3b69 } as const

/** Where the bar starts to warm, and where it is fully amber: the urgent half minute. */
const WARM_MS = 2 * URGENT_MS

function mix(from: number, to: number, t: number): number {
  const at = Math.min(1, Math.max(0, t))
  const channel = (shift: number) => Math.round(((from >> shift) & 0xff) + (((to >> shift) & 0xff) - ((from >> shift) & 0xff)) * at) << shift
  return channel(16) | channel(8) | channel(0)
}

/** A full cell, then a cell seven eighths full, down to an empty one. */
const EIGHTHS = [' ', '▏', '▎', '▍', '▌', '▋', '▊', '▉', '█'] as const

/** One row of cells as a Raster takes them: glyph, foreground, background, base64 of little-endian u32s. */
function pack(cells: { glyph: string; color: number }[]): string {
  const words = new Uint32Array(cells.length * 3)
  cells.forEach((cell, i) => words.set([cell.glyph.codePointAt(0)!, cell.color, RGB.track], i * 3))
  // The engine's runtime has toBase64; the TypeScript lib in use does not declare it yet.
  return (new Uint8Array(words.buffer) as Uint8Array & { toBase64(): string }).toBase64()
}

/**
 * The draining bar as painted cells: an eighth of a cell at a time, blue
 * while there is time, warming to amber as the last half minute comes on.
 */
export function meterCells(life: number, msLeft: number): string {
  const color = mix(RGB.warn, RGB.plan, (msLeft - URGENT_MS) / (WARM_MS - URGENT_MS))
  const eighths = Math.min(METER_CELLS * 8, Math.max(1, Math.round(life * METER_CELLS * 8)))
  return pack(Array.from({ length: METER_CELLS }, (_, i) => ({ glyph: EIGHTHS[Math.min(8, Math.max(0, eighths - i * 8))]!, color })))
}

/** The sweep a confirmed plan gets: how long it crosses for, and how long the full bar then holds. */
export const BURST_SWEEP_MS = 600
export const BURST_MS = 900
export const BURST_FRAME_MS = 40

const GLOW_CELLS = 5

/**
 * One frame of the confirmed sweep: the bar fills green from the left behind
 * a bright head, then holds full. Null once it is over.
 */
export function burstCells(elapsed: number): string | null {
  if (elapsed < 0 || elapsed >= BURST_MS) return null
  const head = (elapsed / BURST_SWEEP_MS) * (METER_CELLS + GLOW_CELLS)
  return pack(
    Array.from({ length: METER_CELLS }, (_, i) =>
      i > head ? { glyph: ' ', color: RGB.ok } : { glyph: '█', color: mix(RGB.ok, RGB.glow, 1 - (head - i) / GLOW_CELLS) },
    ),
  )
}

const two = (n: number): string => String(n).padStart(2, '0')

/** An expiry as the clock on the wall, in the session's own timezone. */
export function clockTime(iso: string): string | null {
  const at = new Date(iso)
  return Number.isNaN(at.getTime()) ? null : `${two(at.getHours())}:${two(at.getMinutes())}`
}

/** What is left before an expiry, as `4:12`. Null once it has passed or was never a time. */
export function timeLeft(iso: string, now: number): string | null {
  const ms = Date.parse(iso) - now
  if (Number.isNaN(ms) || ms <= 0) return null
  const seconds = Math.ceil(ms / 1000)
  return `${Math.floor(seconds / 60)}:${two(seconds % 60)}`
}
