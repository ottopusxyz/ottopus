import { randomUUID } from 'node:crypto'
import type { ArmRef, Portfolio } from '../connectors/portfolio/index.js'
import { SimulationUnavailableError, type Simulator, asSimulation } from '../connectors/simulation/index.js'
import type { TokenRegistry } from '../connectors/tokens/index.js'
import {
  type Call,
  type CustomIntent,
  type DecodedAction,
  type PlanDraft,
  type Simulation,
  type WalletCandidate,
  type Warning,
  chainName,
  customIntentSchema,
  findChain,
  isNativeAsset,
  nativeAssetIdOf,
  accountOn,
  parseAccountId,
  parseAssetId,
  parseChainId,
  planDraftSchema,
  spendIneligibility,
} from '../core/index.js'
import { assemblePlan } from '../core/index.js'
import { blockWarnings, decodeCalls, verifyPlan } from '../verify/index.js'
import type { Arm } from '../wallets/index.js'
import { canSign, resolveWallet, truncateAddress } from './readable.js'
import { wordsFor } from './trade.js'
import type { PrepareContext, PrepareDeps } from './transfer.js'

/**
 * prepare_custom: calls the agent authored itself, held to a declaration.
 *
 * The escape hatch for intents no built-in tool expresses — add liquidity,
 * claim fees, stake, revoke. No route provider stood behind these calls, so
 * the agent takes the provider's place and makes the provider's promise:
 * what leaves, at most; what gets approved, exactly; what native value
 * moves; what it means. The verify layer's custom tier then holds the bytes
 * and an independent simulation to that promise.
 *
 * Two things differ from the other prepare_* tools, and both follow from
 * "the agent wrote this":
 *
 * The account is an input, not a choice. The calls already bind a wallet;
 * the scorer runs eligibility — can it sign, does it hold what the
 * declaration says may leave — and never selection.
 *
 * The simulation runs here, on the service, before a link exists. The other
 * tools leave that to the review page, whose browser run can only take
 * signing away. A custom plan is *granted* by its simulation — the
 * divergence check is the reason it is allowed to exist — and a grant has to
 * come from a run the service made against a block it recorded.
 */

/** A custom plan has no quote to outlive; the calls may carry their own deadline, which wins when sooner. */
export const CUSTOM_PLAN_TTL_MS = 15 * 60_000

/** Enough for an approval or two and the calls they unlock; more is a script, not a plan. */
export const MAX_CALLS = 8

export interface CustomDeps extends PrepareDeps {
  tokens: TokenRegistry | null
  /**
   * The one simulator that runs at prepare time. Separate from `simulator`
   * on purpose: that one stays null so transfer and trade keep the ledger's
   * decision not to simulate on the service, and this one exists because a
   * custom plan cannot be prepared without a run. Null means this deployment
   * cannot prepare custom plans, and the tool says so rather than inking
   * every attempt.
   */
  customSimulator: Simulator | null
}

export interface CustomCallInput {
  /** A contract address, bare or as CAIP-10 on the plan's chain. */
  to: string
  /** 0x calldata. "0x" for a plain value transfer. */
  data: string
  /** Wei, as a decimal string or 0x hex. Omitted means none. */
  value?: string | undefined
}

export interface PrepareCustomInput {
  account: string
  chainId: string
  calls: CustomCallInput[]
  summary: string
  expectedChanges?: { asset: string; maxOut: string }[] | undefined
  approvals?: { asset: string; spender: string; amount: string }[] | undefined
  nativeValue?: string | undefined
  note?: string | undefined
}

export type CustomOutcome =
  | { kind: 'invalid'; reasons: string[] }
  | { kind: 'no_wallet'; reasons: string[] }
  /** This deployment has no simulator to grant a custom plan with. */
  | { kind: 'unavailable'; reasons: string[] }
  | { kind: 'blocked'; planId: string; summary: string; reasons: string[]; warnings: Warning[] }
  | {
      kind: 'ready'
      planId: string
      status: 'awaiting_review'
      summary: string
      account: string
      /** What the simulation saw move, so the agent sees the same comparison the page will. */
      observed: { asset: string; symbol: string | null; diff: string }[]
      warnings: Warning[]
      expiresAt: string
      reviewUrl: string
      linkExpiresAt: string
    }

/**
 * A vendor-shaped transaction into a `Call`. `value` arrives as hex from
 * every transaction-building API; `to` as a bare address; both are turned
 * into what the plan format wants before anything reads them.
 */
export function normaliseCall(input: CustomCallInput, chainId: string): Call | { error: string } {
  const to = input.to.trim()
  const address = /^0x[0-9a-fA-F]{40}$/.test(to)
    ? to.toLowerCase()
    : to.startsWith(`${chainId}:`) && /^0x[0-9a-fA-F]{40}$/.test(to.slice(chainId.length + 1))
      ? to.slice(chainId.length + 1).toLowerCase()
      : null
  if (!address) return { error: `to: ${to} is not an address on ${chainId}` }
  if (!/^0x[0-9a-fA-F]*$/.test(input.data)) return { error: `data: expected 0x-prefixed hex for the call to ${truncateAddress(address)}` }
  let value = '0'
  if (input.value !== undefined && input.value !== '') {
    const raw = input.value.trim()
    if (/^0x[0-9a-fA-F]+$/.test(raw)) value = BigInt(raw).toString()
    else if (/^[0-9]+$/.test(raw)) value = BigInt(raw).toString()
    else return { error: `value: ${raw} is neither decimal wei nor 0x hex` }
  }
  return { to: `${chainId}:${address}`, value, data: input.data.toLowerCase(), chainId }
}

/**
 * A deadline the calldata itself carries, in unix seconds, when any call
 * has one. Read off the decoded arguments: a top-level `deadline`, or one
 * inside a tuple the decoder printed as JSON. Best effort — a plan that
 * outlives the deadline in its own bytes reverts on sign, so the earliest
 * one found caps the plan's expiry.
 */
export function deadlineIn(actions: readonly DecodedAction[]): number | null {
  let earliest: number | null = null
  const consider = (raw: unknown) => {
    const n = typeof raw === 'string' && /^[0-9]{9,11}$/.test(raw) ? Number(raw) : null
    if (n !== null && (earliest === null || n < earliest)) earliest = n
  }
  for (const action of actions) {
    for (const arg of action.args) {
      if (arg.name === 'deadline') consider(arg.value)
      else if (arg.type.startsWith('tuple')) {
        try {
          const parsed = JSON.parse(arg.value) as unknown
          if (parsed && typeof parsed === 'object' && 'deadline' in parsed) consider((parsed as { deadline: unknown }).deadline)
        } catch {
          // Not JSON; not a tuple with a deadline in it.
        }
      }
    }
  }
  return earliest
}

function holdingOf(portfolio: Portfolio | null, assetId: string, walletId: string): bigint {
  const asset = portfolio?.assets.find((a) => a.assetId.toLowerCase() === assetId.toLowerCase())
  const holding = asset?.holdings.find((h) => h.walletId === walletId)
  return holding ? BigInt(holding.amount) : 0n
}

/** One step per call, in words the decoder gave us. */
function stepsOf(actions: readonly DecodedAction[]): string[] {
  return actions.map((a) => {
    const who = a.contractName ?? truncateAddress(parseAccountId(a.target).address)
    if (a.source === 'native') return `Send ${a.value} wei to ${who}`
    const name = a.function.replace(/\(.*$/, '')
    return `${name} on ${who}`
  })
}

export async function prepareCustom(
  ctx: PrepareContext,
  deps: CustomDeps,
  input: PrepareCustomInput,
  now: Date = new Date(),
): Promise<CustomOutcome> {
  let chain
  try {
    chain = parseChainId(input.chainId)
  } catch {
    return { kind: 'invalid', reasons: [`chainId: ${input.chainId} is not a CAIP-2 chain id, e.g. eip155:8453`] }
  }
  const chainId = `${chain.namespace}:${chain.reference}`
  if (!findChain(chain)) return { kind: 'invalid', reasons: [`chain ${chainId} is not one Ottopus knows`] }
  const gasAsset = nativeAssetIdOf(chain)
  if (!gasAsset) {
    return { kind: 'invalid', reasons: [`${chainName(chain)} (${chainId}) is not supported: Ottopus cannot name its native currency, so it cannot check for gas`] }
  }

  if (input.calls.length === 0) return { kind: 'invalid', reasons: ['calls: at least one call is needed'] }
  if (input.calls.length > MAX_CALLS) return { kind: 'invalid', reasons: [`calls: ${input.calls.length} is more than the ${MAX_CALLS} a plan may carry`] }
  const calls: Call[] = []
  for (const raw of input.calls) {
    const call = normaliseCall(raw, chainId)
    if ('error' in call) return { kind: 'invalid', reasons: [call.error] }
    calls.push(call)
  }

  // The calls bind the wallet, but the agent may still name it any way
  // list_wallets lets it.
  const arms = await deps.listWallets(ctx.userId)
  const named = resolveWallet(arms, input.account)
  if (!named.ok) return { kind: 'no_wallet', reasons: [named.reason] }

  const parsed = customIntentSchema.safeParse({
    kind: 'custom',
    fromAccount: accountOn(chain, named.arm.address),
    chainId,
    summary: input.summary,
    expectedChanges: (input.expectedChanges ?? []).map((c) => ({ asset: c.asset.trim().toLowerCase(), maxOut: c.maxOut })),
    approvals: (input.approvals ?? []).map((a) => ({
      asset: a.asset.trim().toLowerCase(),
      spender: a.spender.trim().toLowerCase(),
      amount: a.amount,
    })),
    ...(input.nativeValue ? { nativeValue: input.nativeValue } : {}),
    ...(input.note?.trim() ? { note: input.note.trim() } : {}),
  })
  if (!parsed.success) {
    return { kind: 'invalid', reasons: parsed.error.issues.map((i) => `${i.path.join('.') || 'declaration'}: ${i.message}`) }
  }
  const intent: CustomIntent = parsed.data

  // Eligibility, never selection: the calls chose the wallet already.
  const arm = named.arm
  if (arm.namespace !== 'eip155') return { kind: 'no_wallet', reasons: [`${describe(arm)} is not an EVM wallet`] }
  if (!canSign(arm)) return { kind: 'no_wallet', reasons: [`${describe(arm)} is watch-only and cannot sign`] }
  if (!deps.readPortfolio) {
    return { kind: 'no_wallet', reasons: ['balances are not available on this deployment, so the declaration cannot be checked against what the wallet holds'] }
  }
  const portfolio = await deps.readPortfolio(arms.map((a): ArmRef => ({ walletId: a.id, namespace: a.namespace, address: a.address })))
  const shortfalls: string[] = []
  const assets: { id: string; symbol: string; decimals: number }[] = []
  for (const change of intent.expectedChanges) {
    const words = await wordsFor(change.asset, portfolio, deps.tokens)
    assets.push({ id: change.asset, symbol: words.symbol, decimals: words.decimals })
    const candidate: WalletCandidate = {
      walletId: arm.id,
      account: intent.fromAccount,
      label: arm.label,
      canSign: true,
      assetBalance: holdingOf(portfolio, change.asset, arm.id),
      gasBalance: holdingOf(portfolio, gasAsset, arm.id),
    }
    const why = spendIneligibility(candidate, change.maxOut, words, isNativeAsset(change.asset))
    if (why) shortfalls.push(`${describe(arm)} ${why}`)
  }
  if (shortfalls.length > 0) return { kind: 'no_wallet', reasons: shortfalls }
  for (const approval of intent.approvals) {
    if (assets.some((a) => a.id === approval.asset)) continue
    const words = await wordsFor(approval.asset, portfolio, deps.tokens)
    assets.push({ id: approval.asset, symbol: words.symbol, decimals: words.decimals })
  }

  const decodedActions = await decodeCalls(calls, deps.lookups)

  // The deadline in the bytes caps the plan; one already behind us is not a plan.
  const deadline = deadlineIn(decodedActions)
  const ttlEnd = now.getTime() + CUSTOM_PLAN_TTL_MS
  if (deadline !== null && deadline * 1000 <= now.getTime()) {
    return { kind: 'invalid', reasons: [`the calldata carries a deadline of ${new Date(deadline * 1000).toISOString()}, which has passed`] }
  }
  const expiresAt = new Date(deadline !== null ? Math.min(ttlEnd, deadline * 1000) : ttlEnd).toISOString()

  if (!deps.customSimulator) {
    return { kind: 'unavailable', reasons: ['this deployment has no simulator, and a custom plan cannot be prepared without one'] }
  }
  const simulation = await simulate(deps.customSimulator, { chainId, account: intent.fromAccount, calls, gasAsset, portfolio })

  const draft: PlanDraft = planDraftSchema.parse({
    id: randomUUID(),
    version: 1,
    userId: ctx.userId,
    createdVia: 'agent',
    intent,
    provenance: 'agent_crafted',
    resolution: {
      account: { caip10: intent.fromAccount, ...(arm.label ? { label: arm.label } : {}) },
      candidatesConsidered: [],
      reason:
        'Chosen by the agent, which authored these calls. Ottopus checked that it can sign and holds what the declaration says may leave; it weighed no alternatives.',
    },
    outcome: { type: 'calls', calls },
    quote: { provider: 'agent', expiresAt },
    humanPlan: {
      summary: intent.summary,
      steps: [...stepsOf(decodedActions), ...(intent.note ? [`Note from the request: ${intent.note}`] : [])],
      feesUsd: simulation?.gasUsd ?? 'unknown',
      warnings: [],
      assets,
    },
    status: 'awaiting_review',
    expiresAt,
  })

  const verdict = verifyPlan({ intent, calls, decodedActions, simulation })
  const warnings = blockWarnings(verdict)
  const plan = assemblePlan(
    { ...draft, status: verdict.ok ? 'awaiting_review' : 'blocked', humanPlan: { ...draft.humanPlan, warnings } },
    { decodedActions, simulation },
  )
  const record = await deps.createPlan({ plan, walletId: arm.id, grantId: ctx.grantId })
  if (simulation && deps.recordSimulation) {
    await deps.recordSimulation({ planId: record.plan.id, planVersion: record.plan.version, simulation }).catch(() => {})
  }

  if (!verdict.ok) {
    return { kind: 'blocked', planId: record.plan.id, summary: intent.summary, reasons: verdict.reasons, warnings }
  }
  const link = await deps.issueReviewLink(record.plan.id, record.plan.version, record.plan.expiresAt)
  return {
    kind: 'ready',
    planId: record.plan.id,
    status: 'awaiting_review',
    summary: intent.summary,
    account: describe(arm),
    observed: (simulation?.assetChanges ?? []).map((c) => ({ asset: c.assetId, symbol: c.symbol, diff: c.diff })),
    warnings,
    expiresAt: record.plan.expiresAt,
    reviewUrl: link.url,
    linkExpiresAt: link.expiresAt,
  }
}

function describe(arm: Arm): string {
  const address = truncateAddress(arm.address)
  return arm.label ? `${arm.label} (${address})` : address
}

interface SimulateArgs {
  chainId: string
  account: string
  calls: Call[]
  gasAsset: string
  portfolio: Portfolio | null
}

/**
 * Run it, or return null and let the custom tier say what null means.
 *
 * Unlike the transfer's simulate, null here is not "no evidence, carry on":
 * the tier blocks a custom plan that has no run. The tool still records the
 * blocked plan rather than refusing outright, so an RPC that would not
 * answer leaves a row in Activity saying why, and the agent gets the reason.
 */
async function simulate(simulator: Simulator, args: SimulateArgs): Promise<Simulation | null> {
  if (!simulator.serves(args.chainId)) return null
  try {
    const run = await simulator.simulate({ chainId: args.chainId, account: args.account, calls: args.calls })
    const native = args.portfolio?.assets.find((a) => a.assetId.toLowerCase() === args.gasAsset.toLowerCase())
    return asSimulation(run, {
      gasPriceWei: (run.raw as { baseFeePerGas?: string | null } | null)?.baseFeePerGas ?? null,
      nativePriceUsd: native?.price ?? null,
      nativeDecimals: native?.asset.decimals ?? findChain(args.chainId)?.nativeCurrency.decimals ?? null,
    })
  } catch (err) {
    if (err instanceof SimulationUnavailableError) return null
    return null
  }
}

/** The words the agent reads out. The structured copy carries the same facts. */
export function customText(outcome: CustomOutcome): string {
  const list = (reasons: string[]) => reasons.map((r) => `- ${r}`).join('\n')
  switch (outcome.kind) {
    case 'invalid':
      return `That is not a plan Ottopus can build:\n${list(outcome.reasons)}`
    case 'no_wallet':
      return `The named wallet cannot make this plan:\n${list(outcome.reasons)}`
    case 'unavailable':
      return `Custom plans are not available here:\n${list(outcome.reasons)}`
    case 'blocked':
      return [
        `Ottopus refused to build "${outcome.summary}":`,
        list(outcome.reasons),
        'The calls, or what they do, disagree with the declaration. Fix the calls or the declaration and submit again — never by loosening the declaration to match calls you did not mean.',
        'The refusal is recorded in Activity. Nothing was sent.',
      ].join('\n')
    case 'ready': {
      const seen = outcome.observed.filter((c) => c.diff.startsWith('-'))
      return [
        `Plan ready: ${outcome.summary}.`,
        `Signs from ${outcome.account}. Agent-crafted: no route provider stood behind these calls, and the page will say so.`,
        seen.length
          ? `The simulation saw leave: ${seen.map((c) => `${c.diff.slice(1)} ${c.symbol ?? truncateAddress(parseAssetId(c.asset).assetReference)}`).join(', ')} — all within what was declared.`
          : 'The simulation saw nothing leave the wallet.',
        ...outcome.warnings.map((w) => `Heads up: ${w.message}`),
        `Review and sign: ${outcome.reviewUrl}`,
        `The plan expires at ${outcome.expiresAt}. Nothing moves until the person signs in their own wallet.`,
      ].join('\n')
    }
  }
}
