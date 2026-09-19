import type { AssetDelta, DecodedAction, Plan, PlanStatusName, PlanWarning, Simulation } from '@/lib/api'
import { chainName } from '@/lib/chains'
import { addressOf, formatAmount, truncateAddress } from '@/lib/format'

/**
 * What the page shows, derived from the stored plan and nothing else. Every
 * function here is a reading of data the service already verified; none of
 * them decodes, hashes or checks anything, and none of them may.
 */

/** Statuses a plan can never leave. Mirrors TERMINAL_STATUSES in the service. */
export const TERMINAL: ReadonlySet<PlanStatusName> = new Set([
  'confirmed',
  'failed',
  'expired',
  'blocked',
  'superseded',
  'cancelled',
])

/**
 * The status right now. The service derives expiry the same way; doing it
 * here too means the page flips to expired the moment the clock passes,
 * without a round trip, and the sign button goes with it.
 */
export function effectiveStatus(plan: Pick<Plan, 'status' | 'expiresAt'>, now = Date.now()): PlanStatusName {
  if (TERMINAL.has(plan.status) || plan.status === 'submitted') return plan.status
  return new Date(plan.expiresAt).getTime() <= now ? 'expired' : plan.status
}

/** Only these may reach the sign button. */
export function canSign(status: PlanStatusName): boolean {
  return status === 'awaiting_review' || status === 'awaiting_signature'
}

export function chainOfPlan(plan: Plan): string {
  const [namespace, reference] = plan.resolution.account.caip10.split(':')
  return `${namespace}:${reference}`
}

export interface AssetWords {
  symbol: string
  decimals: number
}

/** The words for an asset id, if the plan recorded them. */
export function assetWords(plan: Plan, assetId: string): AssetWords | null {
  const hit = plan.humanPlan.assets?.find((a) => a.id.toLowerCase() === assetId.toLowerCase())
  return hit ? { symbol: hit.symbol, decimals: hit.decimals } : null
}

export interface AssetChange {
  direction: 'out' | 'in'
  /** Formatted, e.g. "500" — never a float. */
  amount: string
  symbol: string
  /** "leaves Main", "arrives at koshik.eth" */
  where: string
  /** The CAIP-19 id, so the row can find its icon. */
  assetId: string
}

/**
 * What moves.
 *
 * The simulation's traced balances when there are any, because those were
 * observed; the intent when there are not, because a plan on a chain nobody
 * simulates still has to say what it will do. The two are not interchangeable
 * and the page labels which one it is showing — `changeSource` is how it
 * knows.
 *
 * The simulation traces the signing account's balances, so every row is about
 * that wallet: what left it, and anything that arrived in it.
 */
export function assetChanges(plan: Plan, live?: Simulation | null): AssetChange[] {
  const holder = holderOf(plan)
  const traced = (live ?? plan.simulation)?.assetChanges ?? []
  if (traced.length > 0) return traced.map((delta) => observedRow(delta, holder))

  if (plan.intent.kind === 'transfer') {
    const words = assetWords(plan, plan.intent.asset)
    if (!words) return []
    return [
      {
        direction: 'out',
        amount: formatAmount(plan.intent.amount, words.decimals),
        symbol: words.symbol,
        where: `leaves ${holder}`,
        assetId: plan.intent.asset,
      },
    ]
  }

  /**
   * A trade, read off the request when no simulation has been observed.
   *
   * Without this a swap showed no asset rows at all until a simulation
   * landed — so the amounts, and the icons that hang off them, were simply
   * absent on the page whose whole job is to say what moves. The card labels
   * these as coming from the request, which is what they are: the quote's
   * expectation, not an observation.
   */
  if (plan.intent.kind === 'swap' || plan.intent.kind === 'bridge') {
    const { from, to, amountIn } = plan.intent
    const rows: AssetChange[] = []
    const paid = assetWords(plan, from)
    if (paid && amountIn) {
      rows.push({
        direction: 'out',
        amount: formatAmount(amountIn, paid.decimals),
        symbol: paid.symbol,
        where: `leaves ${holder}`,
        assetId: from,
      })
    }
    const got = assetWords(plan, to)
    const expected = plan.quote.expectedOut
    if (got && expected) {
      const crossing = chainOfAsset(to) !== chainOfAsset(from)
      rows.push({
        direction: 'in',
        amount: formatAmount(expected, got.decimals),
        symbol: got.symbol,
        where: crossing ? `arrives on ${chainName(chainOfAsset(to))}` : `arrives in ${holder}`,
        assetId: to,
      })
    }
    return rows
  }

  /**
   * An agent-crafted plan, read off the declaration when no simulation has
   * been observed. Each row is a ceiling, not a figure — the agent promised
   * no more than this would leave — and the wording says so, because a page
   * that printed a bound as an amount would be the declaration overclaiming.
   */
  if (plan.intent.kind === 'custom') {
    const rows: AssetChange[] = []
    for (const change of plan.intent.expectedChanges) {
      const words = assetWords(plan, change.asset)
      if (!words) continue
      rows.push({
        direction: 'out',
        amount: formatAmount(change.maxOut, words.decimals),
        symbol: words.symbol,
        where: `at most, leaves ${holder}`,
        assetId: change.asset,
      })
    }
    return rows
  }
  return []
}

/** The CAIP-2 chain an asset id names. */
function chainOfAsset(assetId: string): string {
  const [namespace, rest] = assetId.split(':')
  return `${namespace}:${rest?.split('/')[0] ?? ''}`
}

function holderOf(plan: Plan): string {
  return plan.resolution.account.label ?? truncateAddress(addressOf(plan.resolution.account.caip10))
}

/**
 * Where the rows came from, which the page has to say out loud.
 *
 * "live" is a simulation the browser ran while the person was looking, which
 * is the only one that describes the chain as it is now. "stored" is the run
 * the service did when the plan was built — true when it ran, and older than
 * the reader. "request" is the intent, which is a promise rather than an
 * observation.
 */
export type ChangeSource = 'live' | 'stored' | 'request' | 'declared'

export function changeSource(plan: Plan, live?: Simulation | null): ChangeSource {
  if ((live?.assetChanges.length ?? 0) > 0) return 'live'
  if ((plan.simulation?.assetChanges.length ?? 0) > 0) return 'stored'
  // An agent's declaration is a promise about the request, not the request
  // itself, and the page should not let the two read the same.
  return plan.intent.kind === 'custom' ? 'declared' : 'request'
}

export const SOURCE_LABEL: Readonly<Record<ChangeSource, string>> = {
  live: 'simulated just now',
  stored: 'simulated when the plan was built',
  request: 'from the request',
  declared: 'declared by the agent, as ceilings',
}

function observedRow(delta: AssetDelta, holder: string): AssetChange {
  const out = delta.diff.startsWith('-')
  const magnitude = out ? delta.diff.slice(1) : delta.diff
  return {
    direction: out ? 'out' : 'in',
    // A token the simulator could not name is shown in its own units rather
    // than converted by a guessed number of decimals.
    amount: delta.decimals === null ? magnitude : formatAmount(magnitude, delta.decimals),
    symbol: delta.symbol ?? 'units',
    where: out ? `leaves ${holder}` : `arrives in ${holder}`,
    assetId: delta.assetId,
  }
}

/**
 * The line under the asset changes: who simulated, at which block, and that
 * it is a prediction. Null when nothing ran, so the page can say that too
 * rather than implying a pass.
 */
export function simulationNote(plan: Plan, live?: Simulation | null): string | null {
  const sim = live ?? plan.simulation
  if (!sim) return null
  const where = `${sim.provider} at block ${sim.blockNumber}`
  if (!sim.success) {
    const which = sim.failedCall ? `call ${sim.failedCall}` : 'the batch'
    return `${where} — ${which} reverted${sim.revertReason ? `: ${sim.revertReason}` : ''}`
  }
  return `Simulated by ${where}. A prediction, not a guarantee.`
}

/**
 * Will it execute? One mark, for the card.
 *
 * The card used to carry the whole revert sentence, which is a paragraph of
 * chain vocabulary in the middle of a decision a person makes in seconds.
 * They need to know that something is wrong, not what; the reason is in the
 * advanced panel, where somebody who wants it will look. Null when nothing
 * has run, because "no simulation" is not a verdict either way.
 */
export interface Executability {
  ok: boolean
  label: string
}

export function executability(plan: Plan, live?: Simulation | null): Executability | null {
  const sim = live ?? plan.simulation
  if (!sim) return null
  return sim.success ? { ok: true, label: 'Executable' } : { ok: false, label: 'May fail' }
}

/**
 * The banner a fresh simulation earns when it disagrees with the plan.
 *
 * The plan was built against a block that has since passed. A browser run
 * that now reverts is the most useful thing the page can tell somebody, and
 * the reason signing is taken away: whatever the service concluded minutes
 * ago, this will not execute.
 */
export function liveRefusal(live: Simulation | null): string | null {
  if (!live || live.success) return null
  const which = live.failedCall ? `Call ${live.failedCall}` : 'This batch'
  return `${which} reverts against the chain as it is right now${live.revertReason ? `: ${live.revertReason}` : ''}.`
}

export interface Recipient {
  address: string
  name: string | null
}

export function recipientOf(plan: Plan): Recipient | null {
  if (plan.intent.kind !== 'transfer') return null
  return { address: addressOf(plan.intent.to), name: plan.intent.toName ?? null }
}

export interface Fact {
  label: string
  value: string
  detail?: string
  mono?: boolean
}

/**
 * What would be left standing if the person signed the approval and stopped.
 *
 * Named in the asset's own words, because "an allowance could remain" is not
 * a thing anybody can weigh and "500 USDC to 0x1231…4eae" is. Null when the
 * plan carries no approval, which is when the question does not arise.
 */
export interface StandingApproval {
  spender: string
  amount: string
  symbol: string
  unlimited: boolean
}

export function standingApproval(plan: Plan): StandingApproval | null {
  const grant = approvals(plan)[0]
  if (!grant) return null
  const words = approvalWords(plan, grant)
  return {
    spender: grant.spender,
    amount: grant.unlimited ? 'unlimited' : words ? formatAmount(grant.amount, words.decimals) : grant.amount,
    symbol: words?.symbol ?? '',
    unlimited: grant.unlimited,
  }
}

/** The asset a plan spends. Mirrors the service's own reading. */
export function sourceAssetIdOf(plan: Plan): string | null {
  if (plan.intent.kind === 'transfer') return plan.intent.asset
  if (plan.intent.kind === 'swap' || plan.intent.kind === 'bridge') return plan.intent.from
  // A custom plan may spend several; the first declared is the one to lead with.
  if (plan.intent.kind === 'custom') return plan.intent.expectedChanges[0]?.asset ?? null
  return null
}

export interface Approval {
  spender: string
  amount: string
  unlimited: boolean
  /** The token being approved — the call's target — as a CAIP-19 id. */
  asset: string
  /** What the decoder called the spender, when it is one of the plan's own targets. */
  spenderName: string | null
}

/** The approvals a plan carries, for the heads-up. */
export function approvals(plan: Plan): Approval[] {
  const chain = chainOfPlan(plan)
  return plan.decodedActions.flatMap((a) =>
    a.approval
      ? [
          {
            spender: a.approval.spender,
            amount: a.approval.amount,
            unlimited: a.approval.amount === 'unlimited',
            asset: `${chain}/erc20:${addressOf(a.target).toLowerCase()}`,
            spenderName:
              plan.decodedActions.find((b) => addressOf(b.target).toLowerCase() === addressOf(a.approval!.spender).toLowerCase())
                ?.contractName ?? null,
          },
        ]
      : [],
  )
}

/**
 * The words for an approved token. The token is the call's target, which on
 * a swap or a custom plan is not necessarily the asset the plan spends — so
 * the target is asked first and the spent asset is only the fallback.
 */
export function approvalWords(plan: Plan, grant: Approval): AssetWords | null {
  const byTarget = assetWords(plan, grant.asset)
  if (byTarget) return byTarget
  const spent = sourceAssetIdOf(plan)
  return spent === null ? null : assetWords(plan, spent)
}

/** "unlimited", "1,000 USDC", or the raw figure when nothing names it. */
export function approvalAmount(plan: Plan, grant: Approval): string {
  if (grant.unlimited) return 'unlimited'
  const words = approvalWords(plan, grant)
  return words ? `${formatAmount(grant.amount, words.decimals)} ${words.symbol}` : grant.amount
}

/** Warnings worth a banner: anything above info. */
export function bannerWarnings(plan: Plan): PlanWarning[] {
  return plan.humanPlan.warnings.filter((w) => w.severity !== 'info')
}

/**
 * Everything a person should read before signing, counted, and how bad the
 * worst of it is. The card says the count and where to look; the heads-up
 * panel says the rest.
 */
export interface HeadsUp {
  grants: Approval[]
  warnings: PlanWarning[]
  count: number
  worst: 'caution' | 'block' | null
}

export function headsUp(plan: Plan): HeadsUp {
  const grants = approvals(plan)
  const warnings = bannerWarnings(plan)
  const count = grants.length + warnings.length
  const block = grants.some((g) => g.unlimited) || warnings.some((w) => w.severity === 'block')
  return { grants, warnings, count, worst: count === 0 ? null : block ? 'block' : 'caution' }
}

export interface DecodedRow {
  signature: string
  verified: boolean
  contractName: string | null
  isContract: boolean
  raw: { to: string; value: string; data: string }
}

/** One row per call, pairing the call with what the service decoded it as. */
export function decodedRows(plan: Plan): DecodedRow[] {
  if (plan.outcome.type !== 'calls') return []
  return plan.outcome.calls.map((call, i) => {
    const action: DecodedAction | undefined = plan.decodedActions[i]
    const args = action?.args.map((a) => shortValue(a.type, a.value)).join(', ') ?? ''
    const name = action?.function ?? 'unknown'
    const signature = name === 'nativeTransfer()' ? 'send value' : name === 'unknown' ? 'unknown calldata' : `${name.replace(/\(.*$/, '')}(${args})`
    return {
      signature,
      verified: action?.verified ?? false,
      contractName: action?.contractName ?? null,
      isContract: action?.isContract ?? true,
      raw: { to: addressOf(call.to), value: call.value, data: call.data },
    }
  })
}

function shortValue(type: string, value: string): string {
  if (type === 'address') return truncateAddress(value)
  return value.length > 24 ? `${value.slice(0, 12)}…` : value
}

/** "Verified" when every contract the plan touches has verified source. */
export function verificationSummary(plan: Plan): { allVerified: boolean; contracts: number } {
  const contracts = plan.decodedActions.filter((a) => a.isContract)
  return { allVerified: contracts.every((a) => a.verified), contracts: contracts.length }
}

/** How long until the plan expires, in words. Empty once it has. */
export function countdown(expiresAt: string, now = Date.now()): string {
  const left = Math.max(0, Math.floor((new Date(expiresAt).getTime() - now) / 1000))
  if (left === 0) return ''
  const m = Math.floor(left / 60)
  const s = left % 60
  return m > 0 ? `${m}:${String(s).padStart(2, '0')}` : `${s}s`
}

/** Who prepared it, for the details. */
export function preparedBy(plan: Plan): string {
  return plan.createdVia === 'agent' ? 'An agent, over MCP' : 'You, in Ottopus'
}

/**
 * The rows under the amount, cut to what a person deciding actually needs.
 *
 * The wallet and the network moved into one line beside the amount, and the
 * expiry into the header, so what is left is the fee and anything the person
 * was told about the request. Everything else — hashes, provenance, decoded
 * arguments — belongs in the advanced panel, where somebody who wants it
 * knows to look.
 */
export function keyFacts(plan: Plan): Fact[] {
  const rows: Fact[] = []
  if (plan.humanPlan.feesUsd && plan.humanPlan.feesUsd !== 'unknown') {
    rows.push({ label: 'Network fee', value: `$${plan.humanPlan.feesUsd}`, detail: 'estimated', mono: true })
  } else {
    rows.push({ label: 'Network fee', value: 'Shown by your wallet' })
  }
  if ((plan.intent.kind === 'transfer' || plan.intent.kind === 'custom') && plan.intent.note) {
    rows.push({ label: 'Note', value: plan.intent.note })
  }
  return rows
}

/**
 * What the wallet will be asked to do, one row per call.
 *
 * The panel used to say "One signature in your wallet" and draw a single
 * numbered row, whatever the plan held — so a swap's approval was invisible
 * until the wallet opened twice. A plan's calls are the steps, and a person
 * about to sign should be able to count them.
 */
export interface PlanStep {
  /** 1-based, as a person counts. */
  index: number
  label: string
  /** The spender, the recipient, the contract. Shown small, beside the label. */
  detail?: string
}

/**
 * Prefixes this page writes into `humanPlan.steps` itself, so the route's own
 * words can be told apart from the sentences added around them.
 *
 * Reading our own format is the weak part of this: the route's hops would be
 * better as their own field on `humanPlan`, the way `assets` is. Sniffing
 * costs nothing and works for every plan already stored, which a new field
 * would not.
 */
const ADDED_STEP = /^(At least |Note from the request:|[a-z]+ estimates |[a-z]+ does not estimate )/

export function planSteps(plan: Plan): PlanStep[] {
  if (plan.outcome.type !== 'calls') return []
  const calls = plan.outcome.calls
  const routeWords = plan.humanPlan.steps.filter((step) => !ADDED_STEP.test(step))

  return calls.map((call, i) => {
    const action = plan.decodedActions[i]
    const index = i + 1

    if (action?.approval) {
      const spent = sourceAssetIdOf(plan)
      const words = spent === null ? null : assetWords(plan, spent)
      const amount =
        action.approval.amount === 'unlimited'
          ? 'unlimited'
          : words
            ? `${formatAmount(action.approval.amount, words.decimals)} ${words.symbol}`
            : action.approval.amount
      return {
        index,
        label: `Approve ${amount}`,
        detail: `for ${truncateAddress(addressOf(action.approval.spender))}`,
      }
    }

    // A move we can read is described by what it does, not by its signature.
    const moved = readableMove(plan, call, action)
    if (moved) return { index, ...moved }

    // The last call is the one the route's words describe: one call executes
    // the whole route, however many hops the provider listed.
    if (i === calls.length - 1 && routeWords.length > 0) {
      return { index, label: routeWords.join(', then ') }
    }
    return {
      index,
      label: action?.function === 'unknown' || !action ? 'A call this page could not read' : action.function,
      detail: `on ${truncateAddress(addressOf(call.to))}`,
    }
  })
}

/**
 * A transfer, in words, when the decoder could read it.
 *
 * Printing `transfer(address,uint256)` at somebody about to sign is a worse
 * answer than the page already has: the arguments are right there, and being
 * able to say what a call does is the whole point of decoding it.
 */
function readableMove(
  plan: Plan,
  call: { to: string; value: string },
  action: DecodedAction | undefined,
): { label: string; detail?: string } | null {
  const spent = sourceAssetIdOf(plan)
  const words = spent === null ? null : assetWords(plan, spent)

  if (action?.source === 'native' && call.value !== '0') {
    const amount = words ? `${formatAmount(call.value, words.decimals)} ${words.symbol}` : `${call.value} wei`
    return { label: `Send ${amount}`, detail: `to ${truncateAddress(addressOf(call.to))}` }
  }
  if (action?.function !== 'transfer(address,uint256)') return null
  const to = action.args.find((a) => a.type === 'address')?.value
  const raw = action.args.find((a) => a.type.startsWith('uint'))?.value
  if (!to || !raw) return null
  const amount = words ? `${formatAmount(raw, words.decimals)} ${words.symbol}` : raw
  return { label: `Send ${amount}`, detail: `to ${truncateAddress(to)}` }
}
