import type { PlanStatus } from '../core/index.js'
import { type PlanDb, mintReviewToken, revokeReviewTokens, transition } from './store.js'

/**
 * The review link policy. The store owns the rows; this owns how long a link
 * lives, what kills it, and what it looks like.
 *
 * The URL is the security boundary. Its segment is an opaque token, never a
 * plan id, so a link can expire and rotate without touching the plan, and
 * only the service ever mints or checks one — the web passes it through.
 */

/**
 * Fifteen minutes. The same as a plan's default expiry, and capped to it: a
 * link must never outlive what it points at. Its own clock all the same,
 * so a quote can be refreshed without reissuing the link, and a leaked link
 * dies on its own before the plan does.
 */
export const REVIEW_LINK_TTL_MS = 15 * 60_000

export interface ReviewLink {
  token: string
  url: string
  expiresAt: string
}

export function reviewUrl(webUrl: string, token: string): string {
  return `${webUrl.replace(/\/+$/, '')}/review/${token}`
}

export interface IssueInput {
  planId: string
  version: number
  planExpiresAt: string | Date
}

/** A link to one plan version, expiring with the link's clock or the plan's, whichever is first. */
export async function issueReviewLink(
  db: PlanDb,
  { planId, version, planExpiresAt }: IssueInput,
  webUrl: string,
  now: Date = new Date(),
): Promise<ReviewLink> {
  const planExpiry = new Date(planExpiresAt).getTime()
  const expiresAt = new Date(Math.min(now.getTime() + REVIEW_LINK_TTL_MS, planExpiry))
  const { token } = await mintReviewToken(db, { planId, version, expiresAt })
  return { token, url: reviewUrl(webUrl, token), expiresAt: expiresAt.toISOString() }
}

export interface SupersedeInput {
  userId: string
  planId: string
  version: number
  /** Which re-plan trigger fired. Shown in Activity. */
  detail?: Record<string, unknown> | undefined
}

/**
 * A version is replaced: the event, then every live link to it. Two calls
 * rather than one transaction on purpose — the event is the fact, and if
 * revoking failed after it, the token would still resolve to a plan whose
 * status reads superseded and whose page refuses to sign. The order matters:
 * links die after the status says why.
 */
export async function supersedePlan(db: PlanDb, input: SupersedeInput): Promise<PlanStatus> {
  const status = await transition(db, { ...input, to: 'superseded' })
  await revokeReviewTokens(db, input.planId, input.version)
  return status
}
