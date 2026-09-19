import type { AssetDelta, DecodedAction, Plan, PlanStatusName, PlanWarning, Simulation } from '@/lib/api'
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
  if (plan.intent.kind !== 'transfer') return []
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
export type ChangeSource = 'live' | 'stored' | 'request'

export function changeSource(plan: Plan, live?: Simulation | null): ChangeSource {
  if ((live?.assetChanges.length ?? 0) > 0) return 'live'
  if ((plan.simulation?.assetChanges.length ?? 0) > 0) return 'stored'
  return 'request'
}

export const SOURCE_LABEL: Readonly<Record<ChangeSource, string>> = {
  live: 'simulated just now',
  stored: 'simulated when the plan was built',
  request: 'from the request',
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

/** The approvals a plan carries, for the callout. */
export function approvals(plan: Plan): { spender: string; amount: string; unlimited: boolean }[] {
  return plan.decodedActions.flatMap((a) =>
    a.approval ? [{ spender: a.approval.spender, amount: a.approval.amount, unlimited: a.approval.amount === 'unlimited' }] : [],
  )
}

/** Warnings worth a banner: anything above info. */
export function bannerWarnings(plan: Plan): PlanWarning[] {
  return plan.humanPlan.warnings.filter((w) => w.severity !== 'info')
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
  if (plan.intent.kind === 'transfer' && plan.intent.note) {
    rows.push({ label: 'Note', value: plan.intent.note })
  }
  return rows
}
