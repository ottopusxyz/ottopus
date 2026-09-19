import type { DecodedAction, Plan, PlanStatusName, PlanWarning } from '@/lib/api'
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
}

/**
 * What moves. For a transfer that is one outgoing row, read from the intent.
 * The simulation diff replaces this in M4; until then the page is honest that
 * it is the intent, not an observed result.
 */
export function assetChanges(plan: Plan): AssetChange[] {
  if (plan.intent.kind !== 'transfer') return []
  const words = assetWords(plan, plan.intent.asset)
  if (!words) return []
  const from = plan.resolution.account.label ?? truncateAddress(addressOf(plan.resolution.account.caip10))
  return [
    {
      direction: 'out',
      amount: formatAmount(plan.intent.amount, words.decimals),
      symbol: words.symbol,
      where: `leaves ${from}`,
    },
  ]
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

/** The rows under the asset changes. Five at most, and only what is known. */
export function facts(plan: Plan): Fact[] {
  const chain = chainOfPlan(plan)
  const signer = plan.resolution.account
  const rows: Fact[] = [
    {
      label: 'Signing with',
      value: signer.label ?? truncateAddress(addressOf(signer.caip10)),
      detail: signer.label ? truncateAddress(addressOf(signer.caip10)) : undefined,
    },
    { label: 'Network', value: chainName(chain), detail: 'no bridge' },
  ]
  if (plan.humanPlan.feesUsd && plan.humanPlan.feesUsd !== 'unknown') {
    rows.push({ label: 'Network fee (est.)', value: `$${plan.humanPlan.feesUsd}`, mono: true })
  } else {
    rows.push({ label: 'Network fee', value: 'Your wallet will show it', detail: 'estimated at signing' })
  }
  if (plan.intent.kind === 'transfer' && plan.intent.note) {
    rows.push({ label: 'Note', value: plan.intent.note })
  }
  return rows
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
