import { z } from 'zod'
import {
  type PlanStatus,
  type Warning,
  chainName,
  explorerTxUrl,
  isTerminal,
  sourceChainOf,
} from '../core/index.js'
import { PlanError, type PlanRecord, type TransitionInput } from '../plans/index.js'

/**
 * get_plan and cancel_plan: the agent's window onto a plan after it is built.
 *
 * Both are narrow on purpose. What comes back is status and outcome in words
 * — never the calls, never the decoded arguments, never a link the agent did
 * not already have. A plan's calldata is for the review page and the wallet;
 * an agent that could read it back could also replay it somewhere else.
 *
 * Both are scoped to the grant that made the plan. An agent sees only what
 * it prepared: a plan built on the web, or by another agent, does not exist
 * as far as this one is concerned. Over stdio there is no grant, and plans
 * built there share the web's empty grant, so a local agent sees both — that
 * is the developer at their own database, not a hole.
 */

export interface StatusDeps {
  findPlan(userId: string, planId: string): Promise<PlanRecord | null>
  transition(input: TransitionInput): Promise<PlanStatus>
}

export interface StatusContext {
  userId: string
  grantId: string | null
}

/** What an agent may know about a plan. No calls, no evidence, no link. */
export interface PlanView {
  planId: string
  version: number
  status: PlanStatus
  summary: string
  /** Why this wallet, in the scorer's words. */
  reason: string
  account: { caip10: string; label?: string | undefined }
  chain: { id: string; name: string }
  warnings: Warning[]
  createdVia: 'agent' | 'web'
  expiresAt: string
  statusAt: string
  /** Once submitted. The one thing an agent may act on: it can only look it up. */
  txHash: string | null
  explorerUrl: string | null
  /** The status, as a sentence the agent can repeat. */
  outcome: string
}

export type GetPlanOutcome = { kind: 'not_found'; planId: string } | { kind: 'found'; view: PlanView }

export type CancelOutcome =
  | { kind: 'not_found'; planId: string }
  | { kind: 'cancelled'; view: PlanView }
  /** Too late, or already over. The view says which. */
  | { kind: 'refused'; view: PlanView }

const isUuid = (id: string) => z.uuid().safeParse(id).success

/**
 * The plan, if this grant made it. A malformed id is refused here rather than
 * handed to Postgres, whose uuid column would throw on it.
 */
async function ownPlan(ctx: StatusContext, deps: StatusDeps, planId: string): Promise<PlanRecord | null> {
  if (!isUuid(planId)) return null
  const record = await deps.findPlan(ctx.userId, planId)
  if (!record || record.grantId !== ctx.grantId) return null
  return record
}

function txHashOf(record: PlanRecord): string | null {
  const hash = record.statusDetail?.txHash
  return typeof hash === 'string' ? hash : null
}

/** The status in a sentence. What the agent reads back to the person. */
export function outcomeWords(record: PlanRecord): string {
  const { plan } = record
  const chain = chainName(sourceChainOf(plan.intent))
  const tx = txHashOf(record)
  const txWords = tx ? ` Transaction ${tx}.` : ''
  switch (plan.status) {
    case 'draft':
      return 'Still being built. The person has not been shown anything yet.'
    case 'awaiting_review':
      return `Waiting for the person to open the review link and sign in their wallet. The plan expires at ${plan.expiresAt}.`
    case 'awaiting_signature':
      return 'The person has the review open with the right wallet connected, and has not signed yet.'
    case 'submitted':
      return `Signed and sent to ${chain}; waiting for the chain to confirm it.${txWords}`
    case 'confirmed':
      return `Confirmed on ${chain}: ${plan.humanPlan.summary} went through.${txWords}`
    case 'failed': {
      const reason = record.statusDetail?.reason
      if (reason === 'dropped') {
        return (
          `No receipt appeared on ${chain} within a day of sending, so the wallet most likely dropped or replaced ` +
          `the transaction. Ottopus cannot say what became of it; the wallet's own history can.${txWords}`
        )
      }
      const why = typeof reason === 'string' && reason ? ` (${reason})` : ''
      return `The transaction failed on ${chain}${why}. The transfer did not happen; only gas was spent.${txWords}`
    }
    case 'expired':
      return 'Expired before it was signed. Nothing was sent; prepare it again if it is still wanted.'
    case 'blocked': {
      const reasons = plan.humanPlan.warnings.filter((w) => w.severity === 'block').map((w) => w.message)
      return `Refused by verification${reasons.length ? `: ${reasons.join('; ')}` : ''}. Nothing was sent.`
    }
    case 'superseded':
      return 'Replaced by a newer version of the same plan.'
    case 'cancelled':
      return 'Cancelled before it was signed. Nothing was sent.'
  }
}

export function viewOf(record: PlanRecord): PlanView {
  const { plan } = record
  const chain = sourceChainOf(plan.intent)
  const chainId = `${chain.namespace}:${chain.reference}`
  const txHash = txHashOf(record)
  return {
    planId: plan.id,
    version: plan.version,
    status: plan.status,
    summary: plan.humanPlan.summary,
    reason: plan.resolution.reason,
    account: plan.resolution.account,
    chain: { id: chainId, name: chainName(chain) },
    warnings: plan.humanPlan.warnings,
    createdVia: plan.createdVia,
    expiresAt: plan.expiresAt,
    statusAt: record.statusAt,
    txHash,
    explorerUrl: txHash ? explorerTxUrl(chain, txHash) : null,
    outcome: outcomeWords(record),
  }
}

export async function getPlan(ctx: StatusContext, deps: StatusDeps, planId: string): Promise<GetPlanOutcome> {
  const record = await ownPlan(ctx, deps, planId)
  return record ? { kind: 'found', view: viewOf(record) } : { kind: 'not_found', planId }
}

/**
 * Cancel, if the state machine allows it from wherever the plan is right now.
 *
 * The store decides under a row lock, so a cancel racing a signature in the
 * browser cannot both win: whichever event lands second is refused, and the
 * refusal re-reads the plan to say what it lost to.
 */
export async function cancelPlan(ctx: StatusContext, deps: StatusDeps, planId: string): Promise<CancelOutcome> {
  const record = await ownPlan(ctx, deps, planId)
  if (!record) return { kind: 'not_found', planId }
  try {
    await deps.transition({ userId: ctx.userId, planId: record.plan.id, version: record.plan.version, to: 'cancelled' })
  } catch (err) {
    if (err instanceof PlanError && err.code === 'illegal_transition') {
      const now = (await deps.findPlan(ctx.userId, record.plan.id)) ?? record
      return { kind: 'refused', view: viewOf(now) }
    }
    throw err
  }
  const after = (await deps.findPlan(ctx.userId, record.plan.id)) ?? record
  return { kind: 'cancelled', view: viewOf({ ...after, plan: { ...after.plan, status: 'cancelled' } }) }
}

const notFoundText = (planId: string) =>
  `No plan ${planId} was prepared by this agent. get_plan and cancel_plan only see plans this connection built; ` +
  'a plan made on the web or by another agent is not visible here.'

export function getPlanText(outcome: GetPlanOutcome): string {
  if (outcome.kind === 'not_found') return notFoundText(outcome.planId)
  const { view } = outcome
  return [
    `${view.summary}.`,
    `Status: ${view.status}. ${view.outcome}`,
    view.reason,
    ...view.warnings.map((w) => `Heads up: ${w.message}`),
    ...(view.explorerUrl ? [`Explorer: ${view.explorerUrl}`] : []),
  ].join('\n')
}

export function cancelText(outcome: CancelOutcome): string {
  if (outcome.kind === 'not_found') return notFoundText(outcome.planId)
  const { view } = outcome
  if (outcome.kind === 'cancelled') {
    return `Cancelled: ${view.summary}. Nothing was sent, and the review link no longer signs.`
  }
  if (view.status === 'submitted') {
    return (
      `Too late to cancel: ${view.summary} was already signed and sent to ${view.chain.name}. ` +
      `It will confirm or fail on chain; poll get_plan to learn which.${view.txHash ? ` Transaction ${view.txHash}.` : ''}`
    )
  }
  if (isTerminal(view.status)) {
    return `Nothing to cancel: ${view.summary} is already ${view.status}. ${view.outcome}`
  }
  return `Could not cancel ${view.summary} from status ${view.status}. ${view.outcome}`
}
