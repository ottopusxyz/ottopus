import type { CapturedPlan } from '../types'

const PREPARE = /^mcp__(.+)__(prepare_trade|prepare_transfer|prepare_custom)$/

/**
 * The server and tool behind an MCP tool name, when it is one of ours.
 *
 * The server's name is whatever the person called it when they connected it,
 * so it is read off the call rather than assumed.
 */
export function prepareCall(name: string): Pick<CapturedPlan, 'server' | 'tool'> | null {
  const match = PREPARE.exec(name)
  if (!match) return null
  return { server: match[1]!, tool: match[2] as CapturedPlan['tool'] }
}

const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null)

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])

const messages = (v: unknown): string[] =>
  Array.isArray(v) ? v.flatMap((w) => str((w as { message?: unknown } | null)?.message) ?? []) : []

/**
 * A prepare_* result as the plan the card shows, or null when it is not one.
 *
 * The result reaches a hook as the JSON the model read. Anything else — a
 * refusal in prose, a shape from a newer service — is null, and the plain
 * tool output stands on its own exactly as it does without the plugin.
 */
export function capturePlan(call: Pick<CapturedPlan, 'server' | 'tool'>, result: unknown): CapturedPlan | null {
  let data: unknown = result
  if (typeof result === 'string') {
    try {
      data = JSON.parse(result)
    } catch {
      return null
    }
  }
  if (data === null || typeof data !== 'object' || Array.isArray(data)) return null
  const d = data as Record<string, unknown>
  const planId = str(d.planId)
  const status = str(d.status)
  const summary = str(d.summary)
  if (!planId || !status || !summary) return null
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
    reviewUrl: status === 'blocked' ? null : str(d.reviewUrl),
  }
}
