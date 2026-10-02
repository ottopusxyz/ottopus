import type { CapturedPlan } from '../types'

/** What the band draws, as plain words. No element, no surface, no clock of its own. */
export type Card = {
  tone: 'ready' | 'blocked' | 'ended'
  title: string
  summary: string
  /** The wallet, the route and the fees, or why it was refused. Amounts stay on the review page. */
  lines: string[]
  warnings: string[]
  /** When the quote stops holding. Null once that no longer matters. */
  expiresAt: string | null
  link: { href: string; label: string } | null
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

const MAX_LINES = 4

/** `eip155:56:0x1111…1111` reads as a wallet; forty hex characters do not. */
function shortAccount(account: string): string {
  const address = account.split(':').at(-1) ?? account
  return address.length > 13 ? `${address.slice(0, 6)}…${address.slice(-4)}` : address
}

function details(plan: CapturedPlan): string[] {
  return [
    plan.reason ?? (plan.account ? `Wallet ${shortAccount(plan.account)}` : null),
    plan.route ? `Route: ${plan.route}` : null,
    plan.feesUsd ? `Fees about $${plan.feesUsd}` : null,
  ].filter((line): line is string => line !== null)
}

/**
 * The card for a plan at a moment, or null when there is nothing to show.
 *
 * A blocked plan shows its reasons and never a link. A plan past its expiry
 * reads as expired even while the stored status still says ready: the card
 * must not invite a signature the review page will refuse.
 */
export function cardOf(plan: CapturedPlan | null, now: number): Card | null {
  if (!plan) return null
  if (plan.status === 'blocked') {
    return {
      tone: 'blocked',
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
    return { tone: 'ended', title: ended, summary: plan.summary, lines: [], warnings: [], expiresAt: null, link: link('Open plan') }
  }
  return {
    tone: 'ready',
    title: LIVE[plan.status] ?? `Plan ${plan.status.replace(/_/g, ' ')}`,
    summary: plan.summary,
    lines: details(plan),
    warnings: plan.warnings.slice(0, MAX_LINES),
    expiresAt: isSubmitted ? null : plan.expiresAt,
    link: link(isSubmitted ? 'Open plan' : 'Review and sign'),
  }
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
