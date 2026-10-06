import { z } from 'zod'
import {
  type PlanStatus,
  RpcReadError,
  type Warning,
  chainName,
  crossesChains,
  destinationChainOf,
  explorerTxUrl,
  isTerminal,
  parseAccountId,
  sourceChainOf,
} from '../core/index.js'
import {
  type ExecutionReport,
  type Handoff,
  PlanError,
  type PlanRecord,
  type PlanRef,
  TX_HASH,
  type TransitionInput,
} from '../plans/index.js'

/**
 * get_plan, cancel_plan and report_execution: the agent's window onto a plan
 * after it is built.
 *
 * All are narrow on purpose. What comes back is status and outcome in words
 * — never the decoded arguments, never a link the agent did not already
 * have, and never the calls, with one exception: a plan bound to a wallet
 * the agent itself operates, once a person (or a rule they set) has approved
 * it. That agent's wallet is the one that sends, so get_plan hands it the
 * calls and how to send them, and report_execution takes back the hash. For
 * every other plan the calldata stays with the review page and the wallet;
 * an agent that could read it back could also replay it somewhere else.
 *
 * All are scoped to the grant that made the plan. An agent sees only what
 * it prepared: a plan built on the web, or by another agent, does not exist
 * as far as this one is concerned. Over stdio there is no grant, and plans
 * built there share the web's empty grant, so a local agent sees both — that
 * is the developer at their own database, not a hole.
 */

export interface StatusDeps {
  findPlan(userId: string, planId: string): Promise<PlanRecord | null>
  transition(input: TransitionInput): Promise<PlanStatus>
  /** The calls of an approved plan on an agent-operated arm, or null for anything else. */
  handOff(ref: PlanRef): Promise<Handoff | null>
  /** `approved -> submitted`, refused unless the arm sent the transaction. */
  recordExecution(report: ExecutionReport): Promise<PlanStatus>
  /** Who sent a hash, lowercased; null while the chain has not seen it. Throws when it cannot be read. */
  readSender(chainId: string, txHash: string): Promise<string | null>
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

/** What the agent of an agentic arm is handed once its plan is approved, and nothing before. */
export interface HandoffView {
  planHash: string
  /** In order. `to` is a plain address, `value` is wei, `chainId` is CAIP-2. */
  calls: { to: string; value: string; data: string; chainId: string }[]
  /** The wallet that sends them. */
  from: string
  /** How, in the provider's own words. */
  execute: { provider: string; steps: string[] }
  handedOffAt: string
  /** False when an earlier read already released these calls. */
  first: boolean
}

export type GetPlanOutcome =
  | { kind: 'not_found'; planId: string }
  | { kind: 'found'; view: PlanView; handoff?: HandoffView }

export type ReportOutcome =
  | { kind: 'not_found'; planId: string }
  | { kind: 'bad_hash'; txHash: string }
  | { kind: 'reported'; view: PlanView }
  /** The same hash, reported again. */
  | { kind: 'already_reported'; view: PlanView }
  /** The plan is not waiting on its agent: not approved, never handed out, expired, or already sent. */
  | { kind: 'not_expected'; view: PlanView }
  /** The chain has not seen the hash yet, or could not be read. Worth another try. */
  | { kind: 'unseen'; view: PlanView; txHash: string; unreadable: boolean }
  | { kind: 'wrong_sender'; view: PlanView; txHash: string; sender: string }

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

function handedOffAtOf(record: PlanRecord): string | null {
  const at = record.statusDetail?.handedOffAt
  return typeof at === 'string' ? at : null
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
    case 'approved': {
      const at = handedOffAtOf(record)
      return at
        ? `Approved, and its calls were handed to the agent at ${at}. Waiting for the agent's own wallet to send ` +
            `them and for report_execution to say so. The plan expires at ${plan.expiresAt}.`
        : `Approved, and waiting for the agent's own wallet to send it. The plan expires at ${plan.expiresAt}.`
    }
    case 'submitted':
      return `Signed and sent to ${chain}; waiting for the chain to confirm it.${txWords}`
    case 'confirmed':
      /**
       * "Confirmed" is the truth for one chain and half the truth for two.
       *
       * The receipt job watches the source transaction, so on a crossing plan
       * this fires the moment the money leaves — which is the most anxious
       * point in the whole flow, and the one place a page or an agent must
       * not say "went through". Watching the destination is its own job and
       * does not exist yet; until it does, saying so is the honest answer.
       */
      if (crossesChains(plan.intent)) {
        return (
          `The source transaction confirmed on ${chain}, so the funds have left. They arrive on ` +
          `${chainName(destinationChainOf(plan.intent))} after the bridge settles, which Ottopus does not yet watch — ` +
          `check the destination wallet or the explorer.${txWords}`
        )
      }
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
    case 'expired': {
      // An approved plan that ran out after its calls left: whether they were
      // sent is the agent's wallet's to say, and "nothing was sent" is not ours.
      const at = handedOffAtOf(record)
      if (at) {
        return (
          `Expired with no execution reported. Its calls were handed to the agent at ${at}, so Ottopus cannot say ` +
          `whether the agent's wallet sent them; that wallet's own history can.`
        )
      }
      return 'Expired before it was signed. Nothing was sent; prepare it again if it is still wanted.'
    }
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

function handoffView(handoff: Handoff): HandoffView {
  const calls = handoff.calls.map((call) => ({
    to: parseAccountId(call.to).address,
    value: call.value,
    data: call.data,
    chainId: call.chainId,
  }))
  return {
    planHash: handoff.planHash,
    calls,
    from: handoff.address,
    execute: {
      provider: handoff.profile.name,
      steps: handoff.profile.executeSteps({
        address: handoff.address,
        calls: calls.map((call) => ({ ...call, chainReference: call.chainId.split(':')[1] ?? call.chainId })),
      }),
    },
    handedOffAt: handoff.handedOffAt,
    first: handoff.first,
  }
}

/**
 * Status and outcome, and — for an approved plan on a wallet this agent
 * operates — the calls. The store decides whether they are released, under
 * the plan's lock; this only asks when the status says there is a point.
 */
export async function getPlan(ctx: StatusContext, deps: StatusDeps, planId: string): Promise<GetPlanOutcome> {
  const record = await ownPlan(ctx, deps, planId)
  if (!record) return { kind: 'not_found', planId }
  if (record.plan.status !== 'approved') return { kind: 'found', view: viewOf(record) }

  const handoff = await deps.handOff({ userId: ctx.userId, planId: record.plan.id, version: record.plan.version })
  // Read again either way: a release wrote an event, and a refusal means the
  // plan moved on between the two reads.
  const after = (await deps.findPlan(ctx.userId, record.plan.id)) ?? record
  if (!handoff) return { kind: 'found', view: viewOf(after) }
  return { kind: 'found', view: viewOf(after), handoff: handoffView(handoff) }
}

/**
 * The agent says it sent the plan, and with which transaction. Believed only
 * as far as the chain agrees: the hash has to be a transaction the plan's own
 * arm sent, on the plan's chain. Then the plan is submitted and the receipts
 * job takes it from there.
 */
export async function reportExecution(
  ctx: StatusContext,
  deps: StatusDeps,
  planId: string,
  txHash: string,
): Promise<ReportOutcome> {
  const record = await ownPlan(ctx, deps, planId)
  if (!record) return { kind: 'not_found', planId }
  if (!TX_HASH.test(txHash)) return { kind: 'bad_hash', txHash }
  const hash = txHash.toLowerCase()

  if (record.plan.status !== 'approved') {
    const same = txHashOf(record)?.toLowerCase() === hash
    return { kind: same ? 'already_reported' : 'not_expected', view: viewOf(record) }
  }

  const chain = sourceChainOf(record.plan.intent)
  let sender: string | null
  try {
    sender = await deps.readSender(`${chain.namespace}:${chain.reference}`, hash)
  } catch (err) {
    if (!(err instanceof RpcReadError)) throw err
    return { kind: 'unseen', view: viewOf(record), txHash: hash, unreadable: true }
  }
  if (sender === null) return { kind: 'unseen', view: viewOf(record), txHash: hash, unreadable: false }

  try {
    await deps.recordExecution({
      userId: ctx.userId,
      planId: record.plan.id,
      version: record.plan.version,
      txHash: hash,
      sender,
    })
  } catch (err) {
    if (!(err instanceof PlanError)) throw err
    const now = (await deps.findPlan(ctx.userId, record.plan.id)) ?? record
    if (err.code === 'wrong_sender') return { kind: 'wrong_sender', view: viewOf(now), txHash: hash, sender }
    if (err.code === 'illegal_transition' || err.code === 'not_agentic') return { kind: 'not_expected', view: viewOf(now) }
    throw err
  }
  const after = (await deps.findPlan(ctx.userId, record.plan.id)) ?? record
  return { kind: 'reported', view: viewOf(after) }
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
  `No plan ${planId} was prepared by this agent. get_plan, cancel_plan and report_execution only see plans this ` +
  'connection built; a plan made on the web or by another agent is not visible here.'

/** The calls and how to send them, as the agent reads them. Ends with the one thing to do afterwards. */
function handoffLines(view: PlanView, handoff: HandoffView): string[] {
  const many = handoff.calls.length > 1
  return [
    handoff.first
      ? `The calls are yours to send now, from ${handoff.from} on ${view.chain.name}. Ottopus does not send them.`
      : `Already handed to your agent at ${handoff.handedOffAt}. The same calls again, in case that run was lost; ` +
        `if any of them was already sent, do not send it twice.`,
    `Plan hash: ${handoff.planHash}`,
    ...handoff.calls.map(
      (call, i) => `Call ${i + 1}: to ${call.to}, value ${call.value} wei, data ${call.data}, chain ${call.chainId}`,
    ),
    ...handoff.execute.steps,
    `When ${many ? 'the last call' : 'it'} has a transaction hash, call report_execution with planId ${view.planId} ` +
      `and that hash${many ? ' (the last call’s)' : ''}. Do this before ${view.expiresAt}: an expired plan takes no report.`,
  ]
}

export function getPlanText(outcome: GetPlanOutcome): string {
  if (outcome.kind === 'not_found') return notFoundText(outcome.planId)
  const { view } = outcome
  return [
    `${view.summary}.`,
    `Status: ${view.status}. ${view.outcome}`,
    view.reason,
    ...view.warnings.map((w) => `Heads up: ${w.message}`),
    ...(outcome.handoff ? handoffLines(view, outcome.handoff) : []),
    ...(view.explorerUrl ? [`Explorer: ${view.explorerUrl}`] : []),
  ].join('\n')
}

export function reportText(outcome: ReportOutcome): string {
  switch (outcome.kind) {
    case 'not_found':
      return notFoundText(outcome.planId)
    case 'bad_hash':
      return `"${outcome.txHash}" is not a transaction hash: expected 0x and 64 hex characters.`
    case 'reported':
      return (
        `Recorded: ${outcome.view.summary} was sent to ${outcome.view.chain.name} as ${outcome.view.txHash}. ` +
        `Poll get_plan to learn whether it confirmed.${outcome.view.explorerUrl ? ` Explorer: ${outcome.view.explorerUrl}` : ''}`
      )
    case 'already_reported':
      return `Already reported: that transaction is on record for ${outcome.view.summary}. Status: ${outcome.view.status}. ${outcome.view.outcome}`
    case 'not_expected':
      return (
        `Not recorded: ${outcome.view.summary} is not waiting on an execution report. ` +
        `Status: ${outcome.view.status}. ${outcome.view.outcome}`
      )
    case 'unseen':
      return outcome.unreadable
        ? `Not recorded yet: ${outcome.view.chain.name} could not be read just now, so ${outcome.txHash} could not be checked. Try again shortly.`
        : `Not recorded yet: ${outcome.view.chain.name} has not seen ${outcome.txHash}. If it was only just sent, try again ` +
            'in a few seconds; if it was sent on another chain, it does not belong to this plan.'
    case 'wrong_sender':
      return (
        `Refused: ${outcome.txHash} was sent by ${outcome.sender}, not by the wallet this plan is bound to ` +
        `(${outcome.view.account.caip10.split(':')[2]}). Only a transaction from that wallet can be reported for it.`
      )
  }
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
