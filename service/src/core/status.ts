import { type PlanStatus, isTerminal } from './plan.js'

/**
 * The state machine, as data.
 *
 * One table answers every "may this happen" question, so the store, the MCP
 * tools and the web routes cannot each carry their own slightly different
 * opinion of what a plan may do next. Nothing leaves a terminal state; that is
 * the whole point of having them.
 *
 * `submitted` can only end in `confirmed` or `failed`: the transaction is on
 * chain, and no amount of expiring or cancelling on our side changes that.
 */
export const PLAN_TRANSITIONS: Readonly<Record<PlanStatus, readonly PlanStatus[]>> = {
  draft: ['awaiting_review', 'blocked', 'cancelled', 'expired', 'superseded'],
  awaiting_review: ['awaiting_signature', 'blocked', 'cancelled', 'expired', 'superseded'],
  // Back to awaiting_review when the wallet disconnects or switches account.
  awaiting_signature: [
    'awaiting_review',
    'submitted',
    'blocked',
    'cancelled',
    'expired',
    'superseded',
  ],
  submitted: ['confirmed', 'failed'],
  confirmed: [],
  failed: [],
  expired: [],
  blocked: [],
  superseded: [],
  cancelled: [],
}

export function canTransition(from: PlanStatus, to: PlanStatus): boolean {
  return PLAN_TRANSITIONS[from].includes(to)
}

/**
 * Waiting on a person. What the Requests page lists and the nav badge counts.
 * `draft` is not here — nobody has been asked anything yet — and neither is
 * `submitted`, which is waiting on a chain, not a person.
 */
export const PENDING_STATUSES = ['awaiting_review', 'awaiting_signature'] as const satisfies readonly PlanStatus[]

export function isPending(status: PlanStatus): boolean {
  return (PENDING_STATUSES as readonly PlanStatus[]).includes(status)
}

/**
 * The status a plan is in right now, given the last one written.
 *
 * Expiry is derived rather than written: a plan past `expiresAt` reads as
 * expired the moment the clock passes, whether or not a job has caught up and
 * inserted the event. Until #40 there is no such job, and even with one there
 * is a window. Deriving it closes the window.
 *
 * A submitted plan is never derived expired. The expiry was the quote's, and
 * the quote was already spent.
 */
export function effectiveStatus(
  status: PlanStatus,
  expiresAt: Date | string,
  now: Date = new Date(),
): PlanStatus {
  if (isTerminal(status) || status === 'submitted') return status
  const at = typeof expiresAt === 'string' ? new Date(expiresAt) : expiresAt
  return at.getTime() <= now.getTime() ? 'expired' : status
}
