import type { PlanStatusName, PlanSummary } from '@/lib/api'
import { truncateAddress } from '@/lib/format'

/**
 * The list's reading of rows, pure. The service already sorts waiting-on-you
 * first; this keeps that order stable under filters and derives the counts
 * the pills show.
 */

/** Waiting on a person. Mirrors PENDING_STATUSES in the service. */
export const PENDING: ReadonlySet<PlanStatusName> = new Set(['awaiting_review', 'awaiting_signature'])

/** The order pills appear in, when their status is present. */
export const STATUS_ORDER: readonly PlanStatusName[] = [
  'awaiting_review',
  'awaiting_signature',
  'approved',
  'submitted',
  'confirmed',
  'blocked',
  'failed',
  'expired',
  'cancelled',
  'superseded',
  'draft',
]

export type StatusFilter = 'all' | PlanStatusName
/** "all", or a lowercased address: one wallet is one account on every chain. */
export type WalletFilter = 'all' | string

export function addressOfAccount(caip10: string): string {
  return (caip10.split(':')[2] ?? caip10).toLowerCase()
}

/**
 * Expired is derived on the page too, so a row flips without a reload.
 * `approved` is waiting on the agent rather than the person, and runs out the same way.
 */
export function effectiveStatus(row: Pick<PlanSummary, 'status' | 'expiresAt'>, now = Date.now()): PlanStatusName {
  const terminal = !PENDING.has(row.status) && row.status !== 'draft' && row.status !== 'approved'
  if (terminal || row.status === 'submitted') return row.status
  return Date.parse(row.expiresAt) <= now ? 'expired' : row.status
}

export function sortPlans(rows: readonly PlanSummary[], now = Date.now()): PlanSummary[] {
  return [...rows].sort((a, b) => {
    const pa = PENDING.has(effectiveStatus(a, now)) ? 0 : 1
    const pb = PENDING.has(effectiveStatus(b, now)) ? 0 : 1
    if (pa !== pb) return pa - pb
    return Date.parse(b.createdAt) - Date.parse(a.createdAt)
  })
}

export function statusCounts(rows: readonly PlanSummary[], now = Date.now()): { status: PlanStatusName; count: number }[] {
  const counts = new Map<PlanStatusName, number>()
  for (const row of rows) {
    const s = effectiveStatus(row, now)
    counts.set(s, (counts.get(s) ?? 0) + 1)
  }
  return STATUS_ORDER.filter((s) => counts.has(s)).map((status) => ({ status, count: counts.get(status)! }))
}

export interface WalletOption {
  /** The lowercased address, which is the wallet whatever chain a plan ran on. */
  address: string
  label: string
  count: number
  /** The client it lives in, when the service knew it. */
  walletType: string | null
}

export function walletOptions(rows: readonly PlanSummary[]): WalletOption[] {
  const seen = new Map<string, WalletOption>()
  for (const row of rows) {
    const address = addressOfAccount(row.account.caip10)
    const held = seen.get(address)
    if (held) {
      held.count += 1
      // A later row may know more than the first did.
      held.label = row.account.label ?? row.wallet?.label ?? held.label
      held.walletType ??= row.wallet?.walletType ?? null
    } else {
      seen.set(address, {
        address,
        label: row.account.label ?? row.wallet?.label ?? `${address.slice(0, 6)}…${address.slice(-4)}`,
        count: 1,
        walletType: row.wallet?.walletType ?? null,
      })
    }
  }
  return [...seen.values()].sort((a, b) => b.count - a.count)
}

export function filterPlans(rows: readonly PlanSummary[], status: StatusFilter, wallet: WalletFilter, now = Date.now()): PlanSummary[] {
  return rows.filter(
    (row) =>
      (status === 'all' || effectiveStatus(row, now) === status) &&
      (wallet === 'all' || addressOfAccount(row.account.caip10) === wallet),
  )
}

/** "Send", "Swap"… the verb at the head of a row. */
export function kindWord(kind: PlanSummary['kind']): string {
  return { transfer: 'Send', swap: 'Swap', bridge: 'Bridge', supply: 'Supply', custom: 'Custom' }[kind]
}

/**
 * The second line: what moves and where. A transfer names its recipient, a
 * trade its other side, and a custom plan has only the agent's summary.
 */
export function whatLine(row: PlanSummary): string {
  const symbol = row.asset?.symbol ?? 'Asset'
  if (row.recipient) return `${symbol} → ${row.recipient.name ?? truncateAddress(row.recipient.address)}`
  if (row.toAsset) return `${symbol} → ${row.toAsset.symbol ?? 'a token'}`
  return row.summary
}

export interface RowIcon {
  url: string | null
  name: string
}

/**
 * The icons a row draws. A trade leads with what it buys, which is what the
 * person asked for, and tucks what it pays in front of it, smaller. Anything
 * else has the one asset it moves.
 */
export function rowIcons(row: PlanSummary): { main: RowIcon; paid: RowIcon | null } {
  const paid: RowIcon = { url: row.assetIconUrl, name: row.asset?.symbol ?? kindWord(row.kind) }
  if (!row.toAsset) return { main: paid, paid: null }
  return {
    main: { url: row.toAssetIconUrl, name: row.toAsset.symbol ?? kindWord(row.kind) },
    // An exact-out trade leaves the paid amount to the quote, so the row has no paid side to draw.
    paid: row.asset ? paid : null,
  }
}
