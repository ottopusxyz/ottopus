import type { CapturedPlan } from '../types'
import { txHashOf } from './explorer'

const PREPARE = /^mcp__(.+)__(prepare_trade|prepare_transfer|prepare_custom)$/
const STATUS = /^mcp__(.+)__(get_plan|cancel_plan)$/

/**
 * What makes a prepare_* result Ottopus's rather than a namesake's.
 *
 * A tool name proves nothing: any server can call a tool prepare_trade. So a
 * plan is taken only when its review link leads to the Ottopus web app, and,
 * when the person has named their connection, only from that server.
 */
export type Trust = {
  /** Where a review link must lead, as an origin: `https://ottopus.xyz`. */
  reviewOrigin: string
  /** The one server to listen to, or null for any that passes the link check. */
  server: string | null
}

/** A server's name as a tool name spells it: `claude.ai Ottopus` is `claude_ai_Ottopus`. */
const spelled = (server: string): string => server.replace(/[^a-zA-Z0-9_-]/g, '_')

/**
 * The server and tool behind an MCP tool name, when it is one of ours.
 *
 * The server's name is whatever the person called it when they connected it,
 * so it is read off the call rather than assumed.
 */
export function prepareCall(name: string, trust?: Trust): Pick<CapturedPlan, 'server' | 'tool'> | null {
  const match = PREPARE.exec(name)
  if (!match) return null
  if (trust?.server && spelled(trust.server) !== match[1]) return null
  return { server: match[1]!, tool: match[2] as CapturedPlan['tool'] }
}

/** The server behind a get_plan or cancel_plan call, as the tool name spells it. */
export function statusCall(name: string): string | null {
  return STATUS.exec(name)?.[1] ?? null
}

/** The link, when it is a review page on the trusted origin and nothing else. */
export function trustedReviewUrl(url: string | null, reviewOrigin: string): string | null {
  if (url === null) return null
  try {
    const parsed = new URL(url)
    const isReview = parsed.origin === new URL(reviewOrigin).origin && parsed.pathname.startsWith('/review/')
    return isReview && parsed.username === '' && parsed.password === '' ? parsed.href : null
  } catch {
    return null
  }
}

const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null)

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])

const messages = (v: unknown): string[] =>
  Array.isArray(v) ? v.flatMap((w) => str((w as { message?: unknown } | null)?.message) ?? []) : []

/** A tool result as the JSON object the model read, or null when it is not one. */
function record(result: unknown): Record<string, unknown> | null {
  let data: unknown = result
  if (typeof result === 'string') {
    try {
      data = JSON.parse(result)
    } catch {
      return null
    }
  }
  if (data === null || typeof data !== 'object' || Array.isArray(data)) return null
  return data as Record<string, unknown>
}

/**
 * A prepare_* result as the plan the card shows, or null when it is not one.
 *
 * The result reaches a hook as the JSON the model read. Anything else — a
 * refusal in prose, a shape from a newer service, a plan whose link leads
 * somewhere other than the review page — is null, and the plain tool output
 * stands on its own exactly as it does without the plugin.
 */
export function capturePlan(
  call: Pick<CapturedPlan, 'server' | 'tool'>,
  result: unknown,
  trust: Trust,
): CapturedPlan | null {
  const d = record(result)
  if (!d) return null
  const planId = str(d.planId)
  const status = str(d.status)
  const summary = str(d.summary)
  if (!planId || !status || !summary) return null
  const isBlocked = status === 'blocked'
  const reviewUrl = isBlocked ? null : trustedReviewUrl(str(d.reviewUrl), trust.reviewOrigin)
  // A plan that can be signed always comes with its review page.
  if (!isBlocked && reviewUrl === null) return null
  return {
    ...call,
    planId,
    status,
    summary,
    reason: str(d.reason),
    account: str(d.recommendedAccount) ?? str(d.account),
    route: str(d.route),
    expectedOut: str(d.expectedOut),
    minOut: str(d.minOut),
    feesUsd: str(d.feesUsd),
    warnings: messages(d.warnings),
    reasons: strings(d.reasons),
    expiresAt: str(d.expiresAt),
    reviewUrl,
  }
}

/**
 * What a get_plan the plugin made itself came back with: the structured
 * result when the server sent one, else its first text block.
 */
export function planView(answer: { content: readonly { type: string; text?: string }[]; structuredContent?: unknown }): unknown {
  return answer.structuredContent ?? answer.content.find((block) => block.type === 'text')?.text ?? null
}

/**
 * The plan on the card after a get_plan or cancel_plan result about it, or
 * null when the result is about another plan, from another server, or says
 * nothing new.
 *
 * Only the status and the expiry move, and the chain and the transaction
 * hash are noted once the plan has them. The words and the link stay the ones
 * the prepare call gave: a status check never hands the card a new link, and
 * the explorer's address is built from the hash, never read from the result.
 */
export function followPlan(plan: CapturedPlan, server: string, result: unknown): CapturedPlan | null {
  if (server !== plan.server) return null
  const d = record(result)
  if (!d || str(d.planId) !== plan.planId) return null
  const status = str(d.status)
  if (!status) return null
  const expiresAt = str(d.expiresAt) ?? plan.expiresAt
  const chainId = str((d.chain as { id?: unknown } | null | undefined)?.id) ?? plan.chainId ?? null
  const txHash = txHashOf(d.txHash) ?? plan.txHash ?? null
  const isSame = status === plan.status && expiresAt === plan.expiresAt && txHash === (plan.txHash ?? null)
  if (isSame) return null
  return { ...plan, status, expiresAt, ...(txHash ? { chainId, txHash } : {}) }
}
