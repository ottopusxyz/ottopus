import type { PlanStatusName, PlanSummary } from '@/lib/api'

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
export type WalletFilter = 'all' | string

/** Expired is derived on the page too, so a row flips without a reload. */
export function effectiveStatus(row: Pick<PlanSummary, 'status' | 'expiresAt'>, now = Date.now()): PlanStatusName {
  const terminal = !PENDING.has(row.status) && row.status !== 'draft'
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
  caip10: string
  label: string
  count: number
  /** The client it lives in, when the service knew it. */
  walletType: string | null
}

export function walletOptions(rows: readonly PlanSummary[]): WalletOption[] {
  const seen = new Map<string, WalletOption>()
  for (const row of rows) {
    const key = row.account.caip10.toLowerCase()
    const held = seen.get(key)
    if (held) held.count += 1
    else {
      const address = row.account.caip10.split(':')[2] ?? row.account.caip10
      seen.set(key, {
        caip10: key,
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
      (wallet === 'all' || row.account.caip10.toLowerCase() === wallet),
  )
}

/** "Send", "Swap"… the verb at the head of a row. */
export function kindWord(kind: PlanSummary['kind']): string {
  return { transfer: 'Send', swap: 'Swap', bridge: 'Bridge', supply: 'Supply' }[kind]
}
