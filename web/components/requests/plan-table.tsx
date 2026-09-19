'use client'

import { useState } from 'react'
import { Skeleton, SkeletonRow } from '@/components/motion'
import { AssetIcon } from '@/components/portfolio/asset-icon'
import { WalletMark, type WalletRef } from '@/components/portfolio/wallet-marks'
import { StatusChip } from '@/components/ui'
import { walletMark } from '@/components/wallets/naming'
import type { PlanSummary } from '@/lib/api'
import { cn } from '@/lib/cn'
import { formatAmount, formatMoneyFlat, truncateAddress } from '@/lib/format'
import { WalletFilter } from './wallet-filter'
import {
  type StatusFilter,
  type WalletFilter as WalletChoice,
  effectiveStatus,
  filterPlans,
  kindWord,
  sortPlans,
  statusCounts,
  walletOptions,
} from './plans'

/**
 * P5. A count, a row of filters, and a grid where every row opens its review
 * page. Waiting-on-you rows sit at the top whatever the filter; blocked rows
 * say what did not happen.
 *
 * Desktop is the four-column grid the design draws. Below 640px the columns
 * stack inside the row: request, then amount and status side by side, then
 * the date — a table that scrolls sideways on a phone is a table nobody reads.
 */
export interface PlanTableProps {
  plans: readonly PlanSummary[]
  opening: string | null
  onOpen: (id: string) => void
  /** The clock, owned by the parent so rendering stays pure and expiry still moves. */
  now: number
}

const STATUS_LABEL: Record<string, string> = {
  awaiting_review: 'To review',
  awaiting_signature: 'To sign',
  submitted: 'Submitted',
  confirmed: 'Confirmed',
  blocked: 'Blocked',
  failed: 'Failed',
  expired: 'Expired',
  cancelled: 'Cancelled',
  superseded: 'Replaced',
  draft: 'Draft',
}

export function PlanTable({ plans, opening, onOpen, now }: PlanTableProps) {
  const [status, setStatus] = useState<StatusFilter>('all')
  const [wallet, setWallet] = useState<WalletChoice>('all')
  const sorted = sortPlans(plans, now)
  const counts = statusCounts(sorted, now)
  const wallets = walletOptions(sorted).map((w) => ({ ...w, ref: refFor(w.address, w.label, w.walletType) }))
  const shown = filterPlans(sorted, status, wallet, now)

  return (
    <section className="overflow-hidden rounded-[18px] border border-[var(--ot-border)] bg-[var(--ot-card)]">
      <header className="flex flex-col gap-3 px-4 pt-[18px] pb-3.5 sm:flex-row sm:items-center sm:justify-between sm:px-[22px]">
        <span className="font-[family-name:var(--ot-font-display)] text-[20px] font-semibold">
          {plans.length} {plans.length === 1 ? 'request' : 'requests'}
        </span>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by status">
          <Pill active={status === 'all'} onClick={() => setStatus('all')}>
            All
          </Pill>
          {counts.map((c) => (
            <Pill key={c.status} active={status === c.status} onClick={() => setStatus(status === c.status ? 'all' : c.status)}>
              {STATUS_LABEL[c.status]} <span className="text-[11px] text-[var(--ot-text-3)]">{c.count}</span>
            </Pill>
          ))}
          <WalletFilter wallets={wallets} value={wallet} onChange={setWallet} />
        </div>
      </header>

      {/* The same column header the portfolio's token table uses. */}
      <div className="hidden grid-cols-[minmax(0,1.7fr)_150px_150px_120px] gap-4 px-[22px] pt-1 pb-2 text-[10px] font-semibold tracking-[0.06em] text-[var(--ot-text-2)] uppercase sm:grid">
        <span>Request</span>
        <span className="text-right">Amount</span>
        <span>Status</span>
        <span className="text-right">Date</span>
      </div>

      {shown.length === 0 ? (
        <p className="px-[22px] py-8 text-center text-[13px] text-[var(--ot-text-2)]">Nothing matches that filter.</p>
      ) : (
        <ul className="m-0 list-none p-0">
          {shown.map((row) => (
            <Row key={`${row.id}:${row.version}`} row={row} now={now} opening={opening === row.id} disabled={opening !== null} onOpen={onOpen} />
          ))}
        </ul>
      )}
    </section>
  )
}

function Pill({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'cursor-pointer rounded-full border px-3 py-1.5 text-[12px] font-medium transition-colors',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ot-plan)]',
        active
          ? 'border-[var(--ot-border-strong)] bg-[var(--ot-surface-2)] text-[var(--ot-text)]'
          : 'border-transparent text-[var(--ot-text-3)] hover:bg-[var(--ot-surface-2)] hover:text-[var(--ot-text)]',
      )}
    >
      {children}
    </button>
  )
}

function Row({ row, now, opening, disabled, onOpen }: { row: PlanSummary; now: number; opening: boolean; disabled: boolean; onOpen: (id: string) => void }) {
  const status = effectiveStatus(row, now)
  const created = new Date(row.createdAt)
  const symbol = row.asset?.symbol ?? null
  const amount = row.asset && row.asset.decimals !== null ? formatAmount(row.asset.amount, row.asset.decimals, { maxFractionDigits: 4 }) : null
  const walletName = row.account.label ?? row.wallet?.label ?? truncateAddress(row.account.caip10.split(':')[2] ?? '')
  const mark = row.wallet ? refFor(row.account.caip10, walletName, row.wallet.walletType) : null
  const what = row.recipient ? `${symbol ?? 'Asset'} → ${row.recipient.name ?? truncateAddress(row.recipient.address)}` : row.summary

  return (
    <li className="border-t border-[var(--ot-border)]">
      <button
        type="button"
        disabled={disabled}
        onClick={() => onOpen(row.id)}
        className={cn(
          'grid w-full grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-2 px-4 py-3 text-left transition-colors',
          'sm:grid-cols-[minmax(0,1.7fr)_150px_150px_120px] sm:items-center sm:gap-4 sm:px-[22px] sm:py-[13px]',
          'hover:bg-[var(--ot-surface-2)] focus-visible:outline-2 focus-visible:outline-[var(--ot-plan)] disabled:opacity-60',
          opening && 'bg-[var(--ot-surface-2)]',
        )}
      >
        <span className="col-span-2 flex min-w-0 items-center gap-3 sm:col-span-1">
          <span aria-hidden className="relative h-[34px] w-[34px] flex-none">
            <AssetIcon url={row.assetIconUrl} name={symbol ?? '?'} size={34} className="text-[12px]" />
            {row.chainIconUrl ? (
              <span className="absolute -right-px -bottom-px h-[15px] w-[15px] overflow-hidden rounded-full border-2 border-[var(--ot-card)] bg-[var(--ot-card)]">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={row.chainIconUrl} alt="" className="h-full w-full object-cover" />
              </span>
            ) : null}
          </span>
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className="text-[14px] font-semibold">{kindWord(row.kind)}</span>
            <span className="flex min-w-0 items-center gap-1.5 text-[12px] text-[var(--ot-text-3)]">
              <span className="truncate">{what}</span>
              <span aria-hidden>·</span>
              {mark ? <WalletMark wallet={mark} size={14} className="ring-1 ring-[var(--ot-card)]" /> : null}
              <span className="truncate">{walletName}</span>
              <span aria-hidden>·</span>
              <span className="whitespace-nowrap">#{row.id.slice(0, 6)}</span>
            </span>
          </span>
        </span>

        <span className="flex flex-col gap-0.5 sm:items-end sm:text-right">
          <code className="font-mono text-[14px] font-semibold tabular-nums">
            {row.valueUsd !== null ? `−${formatMoneyFlat(row.valueUsd)}` : amount ? `−${amount} ${symbol ?? ''}` : '—'}
          </code>
          <code className="font-mono text-[12px] text-[var(--ot-text-3)] tabular-nums">
            {row.valueUsd !== null && amount ? `${amount} ${symbol ?? ''}` : ''}
          </code>
        </span>

        <span className="flex flex-wrap items-center gap-1.5">
          <StatusChip status={status} />
          {status === 'blocked' ? <span className="text-[11.5px] text-[var(--ot-block-text)]">Nothing was signed</span> : null}
          {opening ? <span className="text-[11.5px] text-[var(--ot-plan-text)]">Opening…</span> : null}
        </span>

        <span className="col-span-2 flex gap-1.5 text-[12px] text-[var(--ot-text-3)] sm:col-span-1 sm:flex-col sm:gap-0.5 sm:text-right">
          <span className="text-[13px] text-[var(--ot-text-2)]">
            {created.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
          </span>
          <span>{created.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}</span>
        </span>
      </button>
    </li>
  )
}

/** A wallet, as the portfolio's mark component draws one. */
function refFor(caip10: string, name: string, walletType: string | null): WalletRef {
  return {
    id: caip10,
    name,
    icon: walletType ? walletMark(walletType) : null,
    label: null,
    watchOnly: walletType === 'watch_only',
  }
}

/** The table while the list is being read: the header, then four rows of tide. */
export function PlanTableSkeleton() {
  return (
    <section aria-busy className="overflow-hidden rounded-[18px] border border-[var(--ot-border)] bg-[var(--ot-card)]">
      <header className="flex items-center justify-between gap-3 px-4 pt-[18px] pb-3.5 sm:px-[22px]">
        <Skeleton width={120} height={22} radius={6} />
        <span className="flex gap-2">
          <Skeleton width={44} height={30} radius={999} delay={0.1} />
          <Skeleton width={96} height={30} radius={999} delay={0.2} sweep={false} />
          <Skeleton width={80} height={30} radius={999} delay={0.3} sweep={false} />
        </span>
      </header>
      <div className="flex flex-col">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="border-t border-[var(--ot-border)] px-4 py-3 sm:px-[22px]">
            <SkeletonRow avatar={34} label={i === 0 ? 'Loading requests' : null} className={cn(i >= 2 && 'opacity-60')} />
          </div>
        ))}
      </div>
    </section>
  )
}
