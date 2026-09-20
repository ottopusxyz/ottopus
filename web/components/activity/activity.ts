import type { ActivityKind, ActivityRow, Approval, Transfer } from '@/lib/api'
import { formatAmount, truncateAddress } from '@/lib/format'

/**
 * The words and the arithmetic behind the activity table. No React in here,
 * so every rule the rows follow is testable on its own.
 */

/** A filter pill: the kinds it stands for, in the provider's vocabulary. */
export interface KindFilter {
  id: string
  label: string
  kinds: readonly ActivityKind[]
}

/**
 * Seven pills, not fifteen kinds. Deposits, withdrawals and claims are one
 * story — what the wallet did with a protocol — and the long tail of contract
 * calls, mints and delegations is "other" to anyone reading a feed.
 */
export const KIND_FILTERS: readonly KindFilter[] = [
  { id: 'trade', label: 'Trades', kinds: ['trade'] },
  { id: 'send', label: 'Sent', kinds: ['send'] },
  { id: 'receive', label: 'Received', kinds: ['receive'] },
  { id: 'defi', label: 'DeFi', kinds: ['deposit', 'withdraw', 'claim'] },
  { id: 'approve', label: 'Approvals', kinds: ['approve', 'revoke'] },
  { id: 'other', label: 'Other', kinds: ['execute', 'deploy', 'mint', 'burn', 'delegate', 'revoke_delegation', 'bid'] },
]

const KIND_WORDS: Record<ActivityKind, string> = {
  send: 'Sent',
  receive: 'Received',
  trade: 'Trade',
  deposit: 'Deposit',
  withdraw: 'Withdraw',
  approve: 'Approve',
  revoke: 'Revoke',
  claim: 'Claim',
  mint: 'Mint',
  burn: 'Burn',
  execute: 'Contract call',
  deploy: 'Deploy',
  delegate: 'Delegate',
  revoke_delegation: 'Undelegate',
  bid: 'Bid',
}

export function kindWord(kind: ActivityKind): string {
  return KIND_WORDS[kind]
}

/** The two sides of a row: what left the wallet and what arrived. */
export function legs(row: ActivityRow): { out: Transfer[]; in: Transfer[] } {
  return {
    out: row.transfers.filter((t) => t.direction === 'out'),
    in: row.transfers.filter((t) => t.direction === 'in' || t.direction === 'self'),
  }
}

/** "0.0002 ETH", never rounded to nothing. An NFT is its name. */
export function transferWords(transfer: Transfer): string {
  if (transfer.asset.kind === 'nft') return transfer.asset.name
  return `${formatAmount(transfer.amount, transfer.decimals, { maxFractionDigits: 6 })} ${transfer.asset.symbol}`
}

/** "unlimited USDC", or "0.3 USDC". A revoke is an allowance of nothing. */
export function approvalWords(approval: Approval): string {
  const symbol = approval.asset.kind === 'nft' ? approval.asset.name : approval.asset.symbol
  if (approval.unlimited) return `Unlimited ${symbol}`
  if (approval.amount === '0') return `No more ${symbol}`
  return `${formatAmount(approval.amount, approval.decimals, { maxFractionDigits: 6 })} ${symbol}`
}

/** Who the row was with: the app by name, or the other address, or nothing worth saying. */
export interface Counterparty {
  /** "via", "to", "from" — the preposition the line reads with. */
  relation: 'via' | 'to' | 'from' | 'with'
  label: string
  /** The address behind the label, for the explorer. */
  address: string
  iconUrl: string | null
}

/** Case-insensitive, for addresses that arrive in either case. */
function same(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase()
}

export function counterparty(row: ActivityRow, walletAddress: string): Counterparty | null {
  if (row.app?.name) {
    return { relation: 'via', label: row.app.name, address: row.app.contract, iconUrl: row.app.iconUrl }
  }
  const { out, in: inbound } = legs(row)
  if (row.kind === 'send' && out[0]) {
    return { relation: 'to', label: truncateAddress(out[0].recipient), address: out[0].recipient, iconUrl: null }
  }
  if (row.kind === 'receive' && inbound[0]) {
    return { relation: 'from', label: truncateAddress(inbound[0].sender), address: inbound[0].sender, iconUrl: null }
  }
  if (row.to && !same(row.to, walletAddress)) {
    const label = row.app?.method ? `${row.app.method} · ${truncateAddress(row.to)}` : truncateAddress(row.to)
    return { relation: 'with', label, address: row.to, iconUrl: null }
  }
  return null
}

/** A row's day, as a group header reads it: today, yesterday, or the date. */
export function dayLabel(minedAt: string, now: number): string {
  const at = new Date(minedAt)
  const today = new Date(now)
  const startOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const days = Math.round((startOf(today) - startOf(at)) / 86_400_000)
  if (days === 0) return 'Today'
  if (days === 1) return 'Yesterday'
  return at.toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    ...(at.getFullYear() === today.getFullYear() ? {} : { year: 'numeric' }),
  })
}

export interface DayGroup {
  label: string
  rows: ActivityRow[]
}

/** Rows in the order given, split where the day changes. */
export function groupByDay(rows: readonly ActivityRow[], now: number): DayGroup[] {
  const groups: DayGroup[] = []
  for (const row of rows) {
    const label = dayLabel(row.minedAt, now)
    const last = groups.at(-1)
    if (last && last.label === label) last.rows.push(row)
    else groups.push({ label, rows: [row] })
  }
  return groups
}

/** Rows keyed by wallet and id: the same transaction between two arms is two rows. */
export function rowKey(row: ActivityRow): string {
  return `${row.walletId}:${row.id}`
}
