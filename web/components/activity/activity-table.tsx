'use client'

import { useState } from 'react'
import { Skeleton, SkeletonRow } from '@/components/motion'
import { AssetIcon } from '@/components/portfolio/asset-icon'
import { NetworkFilter, WalletFilter, type WalletChoice } from '@/components/portfolio'
import { WalletMark, type WalletRef } from '@/components/portfolio/wallet-marks'
import { AddressChip, Badge, Button } from '@/components/ui'
import type { ActivityRow, Approval, ChainRow, Transfer } from '@/lib/api'
import { explorerAddressUrl, explorerTxUrl } from '@/lib/chains'
import { cn } from '@/lib/cn'
import { formatAmount, formatMoneyFlat } from '@/lib/format'
import { KIND_FILTERS, approvalWords, counterparty, groupByDay, kindWord, legs, rowKey, transferWords } from './activity'
import { KindGlyph } from './kind-glyph'

/**
 * The feed: a row of filters, then the rows grouped by day, then a way to
 * ask for more. Each row is what the requests table draws — a glyph with the
 * chain on it, a title line with the wallet, a line for who it was with —
 * with the two legs of the transaction where the requests table puts its one
 * amount. A row opens in place rather than on its own page: a transaction
 * has a hash, a block and an explorer, and nothing more to review.
 *
 * Below 640px the columns stack: the title, the legs side by side, the time.
 */
export interface ActivityTableProps {
  rows: readonly ActivityRow[]
  chains: readonly ChainRow[]
  /** Icon by chain id, for the badge on the glyph. */
  chainIcons: ReadonlyMap<string, string>
  wallets: readonly WalletChoice[]
  walletRefs: ReadonlyMap<string, WalletRef>
  /** Address by wallet id, so a row knows which side of a transfer is its own. */
  addresses: ReadonlyMap<string, string>
  kind: string
  wallet: string
  chain: string | null
  onKind: (id: string) => void
  onWallet: (id: string) => void
  onChain: (chainId: string | null) => void
  /** Present while there is another page. */
  onMore: (() => void) | null
  more: 'idle' | 'loading' | 'failed'
  now: number
}

const GRID = 'sm:grid-cols-[minmax(0,1.6fr)_minmax(112px,1fr)_minmax(112px,1fr)_92px]'

export function ActivityTable({ rows, chains, chainIcons, wallets, walletRefs, addresses, kind, wallet, chain, onKind, onWallet, onChain, onMore, more, now }: ActivityTableProps) {
  const [open, setOpen] = useState<string | null>(null)
  const groups = groupByDay(rows, now)

  return (
    <section className="overflow-hidden rounded-[18px] border border-[var(--ot-border)] bg-[var(--ot-card)]">
      <header className="flex flex-col gap-3 px-4 pt-[18px] pb-3.5 sm:flex-row sm:items-center sm:justify-between sm:px-[22px]">
        <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by kind">
          <Pill active={kind === 'all'} onClick={() => onKind('all')}>
            All
          </Pill>
          {KIND_FILTERS.map((f) => (
            <Pill key={f.id} active={kind === f.id} onClick={() => onKind(kind === f.id ? 'all' : f.id)}>
              {f.label}
            </Pill>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          <WalletFilter wallets={wallets} value={wallet} onChange={onWallet} />
          <NetworkFilter chains={chains} value={chain} onChange={onChain} />
        </div>
      </header>

      <div className={cn('hidden gap-4 px-[22px] pt-1 pb-2 text-[10px] font-semibold tracking-[0.06em] text-[var(--ot-text-2)] uppercase sm:grid', GRID)}>
        <span>Activity</span>
        <span className="text-right">Out</span>
        <span className="text-right">In</span>
        <span className="text-right">Time</span>
      </div>

      {rows.length === 0 ? (
        <p className="border-t border-[var(--ot-border)] px-[22px] py-8 text-center text-[13px] text-[var(--ot-text-2)]">Nothing matches that filter.</p>
      ) : (
        groups.map((group) => (
          <section key={group.label} aria-label={group.label}>
            <h2 className="border-t border-[var(--ot-border)] bg-[var(--ot-surface-2)] px-4 py-1.5 text-[11px] font-semibold tracking-[0.04em] text-[var(--ot-text-3)] uppercase sm:px-[22px]">
              {group.label}
            </h2>
            <ul className="m-0 list-none p-0">
              {group.rows.map((row) => {
                const key = rowKey(row)
                return (
                  <Row
                    key={key}
                    row={row}
                    wallet={walletRefs.get(row.walletId) ?? null}
                    address={addresses.get(row.walletId) ?? ''}
                    chainIcon={chainIcons.get(row.chainId) ?? null}
                    open={open === key}
                    onToggle={() => setOpen(open === key ? null : key)}
                  />
                )
              })}
            </ul>
          </section>
        ))
      )}

      {onMore ? (
        <footer className="flex flex-col items-center gap-2 border-t border-[var(--ot-border)] px-4 py-3.5 sm:px-[22px]">
          {more === 'failed' ? <p className="text-[12px] text-[var(--ot-block-text)]">Couldn’t read the next page.</p> : null}
          <Button variant="secondary" onClick={onMore} disabled={more === 'loading'}>
            {more === 'loading' ? 'Reading…' : more === 'failed' ? 'Try again' : 'Load more'}
          </Button>
        </footer>
      ) : rows.length > 0 ? (
        <p className="border-t border-[var(--ot-border)] px-[22px] py-3 text-center text-[12px] text-[var(--ot-text-3)]">That is everything Otto can read.</p>
      ) : null}
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

/** How many legs a column shows before it says "+n". Two is a swap with a refund. */
const LEGS_SHOWN = 2

function Row({ row, wallet, address, chainIcon, open, onToggle }: { row: ActivityRow; wallet: WalletRef | null; address: string; chainIcon: string | null; open: boolean; onToggle: () => void }) {
  const mined = new Date(row.minedAt)
  const failed = row.status === 'failed'
  const who = counterparty(row, address)
  const { out, in: inbound } = legs(row)

  return (
    <li className="border-t border-[var(--ot-border)] first:border-t-0">
      <button
        type="button"
        aria-expanded={open}
        onClick={onToggle}
        className={cn(
          'grid w-full cursor-pointer grid-cols-2 gap-x-3 gap-y-2 px-4 py-3 text-left transition-colors',
          GRID,
          'sm:items-center sm:gap-4 sm:px-[22px] sm:py-[13px]',
          'hover:bg-[var(--ot-surface-2)] focus-visible:outline-2 focus-visible:outline-[var(--ot-plan)]',
          open && 'bg-[var(--ot-surface-2)]',
        )}
      >
        <span className="col-span-2 flex min-w-0 items-center gap-3 sm:col-span-1">
          <span className="relative flex-none">
            <KindGlyph kind={row.kind} failed={failed} />
            {chainIcon ? (
              <span className="absolute -right-px -bottom-px h-[15px] w-[15px] overflow-hidden rounded-full border-2 border-[var(--ot-card)] bg-[var(--ot-card)]">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={chainIcon} alt="" className="h-full w-full object-cover" />
              </span>
            ) : null}
          </span>
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className="flex min-w-0 items-center gap-2">
              <span className="text-[14px] font-semibold">{kindWord(row.kind)}</span>
              {failed ? <Badge tone="block">Failed</Badge> : row.status === 'pending' ? <Badge tone="plan">Pending</Badge> : null}
              {wallet ? (
                <span className="flex min-w-0 items-center gap-1 text-[12px] text-[var(--ot-text-3)]">
                  <WalletMark wallet={wallet} size={14} className="flex-none ring-1 ring-[var(--ot-card)]" />
                  <span className="truncate">{wallet.name}</span>
                </span>
              ) : null}
            </span>
            <span className="flex min-w-0 items-center gap-1.5 text-[12px] text-[var(--ot-text-3)]">
              {who ? (
                <>
                  <span className="flex-none">{who.relation}</span>
                  {who.iconUrl ? <AssetIcon url={who.iconUrl} name={who.label} size={14} className="flex-none" /> : null}
                  <span className={cn('truncate', who.relation !== 'via' && 'font-mono')}>{who.label}</span>
                </>
              ) : row.approvals.length > 0 ? (
                <span className="truncate">{row.approvals.map(approvalWords).join(', ')}</span>
              ) : (
                <span className="truncate">{row.app?.method ?? 'On chain'}</span>
              )}
            </span>
          </span>
        </span>

        <Legs transfers={out} approvals={row.kind === 'approve' || row.kind === 'revoke' ? row.approvals : []} sign="−" />
        <Legs transfers={inbound} approvals={[]} sign="+" />

        {/* The fee stays in the opened row; the column is the time alone. */}
        <span className="col-span-2 text-[13px] text-[var(--ot-text-2)] tabular-nums sm:col-span-1 sm:text-right">
          {mined.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
        </span>
      </button>
      {open ? <Detail row={row} address={address} /> : null}
    </li>
  )
}

/** One column of legs: the amounts, the USD under them, a count past the second. */
function Legs({ transfers, approvals, sign }: { transfers: Transfer[]; approvals: Approval[]; sign: '−' | '+' }) {
  const shown = transfers.slice(0, LEGS_SHOWN)
  const rest = transfers.length - shown.length
  const empty = shown.length === 0 && approvals.length === 0
  return (
    <span className={cn('flex min-w-0 flex-col gap-1 sm:items-end sm:text-right', sign === '+' && 'items-end text-right')}>
      {empty ? <span className="text-[13px] text-[var(--ot-text-3)]">—</span> : null}
      {shown.map((t, i) => (
        <span key={i} className="flex min-w-0 items-center gap-1.5 sm:flex-row-reverse">
          {t.asset.kind === 'fungible' ? (
            <AssetIcon url={t.asset.iconUrl} name={t.asset.symbol} size={18} className="flex-none" />
          ) : (
            <AssetIcon url={t.asset.imageUrl} name={t.asset.name} size={18} className="flex-none !rounded-[5px]" />
          )}
          <span className="flex min-w-0 flex-col">
            <code className={cn('truncate font-mono text-[13px] font-semibold tabular-nums', sign === '+' && t.direction !== 'self' && 'text-[var(--ot-ok-text)]')}>
              {t.direction === 'self' ? '' : sign}
              {transferWords(t)}
            </code>
            <code className="font-mono text-[11px] text-[var(--ot-text-3)] tabular-nums">{t.value !== null ? formatMoneyFlat(t.value) : t.asset.kind === 'nft' ? 'NFT' : ''}</code>
          </span>
        </span>
      ))}
      {approvals.map((a, i) => (
        <span key={`a${i}`} className="flex min-w-0 items-center gap-1.5 sm:flex-row-reverse">
          {a.asset.kind === 'fungible' ? <AssetIcon url={a.asset.iconUrl} name={a.asset.symbol} size={18} className="flex-none" /> : null}
          <span className="flex min-w-0 flex-col">
            <code className={cn('truncate font-mono text-[13px] font-semibold tabular-nums', a.unlimited && 'text-[var(--ot-warn-text)]')}>{approvalWords(a)}</code>
            <span className="text-[11px] text-[var(--ot-text-3)]">allowance</span>
          </span>
        </span>
      ))}
      {rest > 0 ? <span className="text-[11px] text-[var(--ot-text-3)]">+{rest} more</span> : null}
    </span>
  )
}

/** "$0.02", or "<$0.01" — a fee is never nothing. */
function feeWords(value: number): string {
  return value > 0 && value < 0.005 ? '<$0.01' : formatMoneyFlat(value)
}

function Detail({ row, address }: { row: ActivityRow; address: string }) {
  const tx = explorerTxUrl(row.chainId, row.hash)
  const who = counterparty(row, address)
  const spender = row.approvals[0]?.spender
  return (
    <div className="grid gap-x-6 gap-y-3 border-t border-dashed border-[var(--ot-border)] bg-[var(--ot-surface-2)] px-4 py-4 text-[12px] sm:grid-cols-2 sm:px-[22px] sm:pl-[68px]">
      <Field label="Hash">
        <AddressChip address={row.hash} className="max-w-full" />
      </Field>
      <Field label="Block">
        <code className="font-mono text-[13px] tabular-nums">{row.block.toLocaleString('en-US')}</code>
      </Field>
      <Field label="From">
        <AddressChip address={row.from} />
      </Field>
      <Field label="To">
        <AddressChip address={row.to} />
      </Field>
      {row.fee ? (
        <Field label="Fee">
          <code className="font-mono text-[13px] tabular-nums">
            {formatAmount(row.fee.amount, row.fee.decimals, { maxFractionDigits: 8 })} {row.fee.symbol}
            {row.fee.value !== null ? <span className="text-[var(--ot-text-3)]"> · {feeWords(row.fee.value)}</span> : null}
          </code>
        </Field>
      ) : null}
      {who?.relation === 'via' ? (
        <Field label={row.app?.method ? `Via · ${row.app.method}` : 'Via'}>
          <span className="flex items-center gap-1.5">
            {who.iconUrl ? <AssetIcon url={who.iconUrl} name={who.label} size={16} /> : null}
            <span className="font-medium">{who.label}</span>
            <AddressChip address={who.address} />
          </span>
        </Field>
      ) : null}
      {row.approvals.map((a, i) => (
        <Field key={i} label={a.unlimited ? 'Allowance · unlimited' : 'Allowance'}>
          <span className="flex flex-wrap items-center gap-1.5">
            <span className="font-medium">{approvalWords(a)}</span>
            <span className="text-[var(--ot-text-3)]">to</span>
            <AddressChip address={a.spender} full />
          </span>
        </Field>
      ))}
      {row.transfers.length > LEGS_SHOWN ? (
        <Field label="Every transfer" className="sm:col-span-2">
          <ul className="m-0 flex list-none flex-col gap-1 p-0">
            {row.transfers.map((t, i) => (
              <li key={i} className="flex items-center gap-2">
                <code className={cn('font-mono text-[13px] tabular-nums', t.direction === 'in' && 'text-[var(--ot-ok-text)]')}>
                  {t.direction === 'out' ? '−' : t.direction === 'in' ? '+' : ''}
                  {transferWords(t)}
                </code>
                {t.value !== null ? <span className="text-[var(--ot-text-3)]">{formatMoneyFlat(t.value)}</span> : null}
              </li>
            ))}
          </ul>
        </Field>
      ) : null}
      <div className="flex flex-wrap gap-2 sm:col-span-2">
        {tx ? (
          <a href={tx} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-full border border-[var(--ot-border)] bg-[var(--ot-card)] px-3 py-1.5 text-[12px] font-medium hover:bg-[var(--ot-surface-3)]">
            View on explorer <span aria-hidden>↗</span>
          </a>
        ) : null}
        {spender && explorerAddressUrl(row.chainId, spender) ? (
          <a href={explorerAddressUrl(row.chainId, spender)!} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-full border border-[var(--ot-border)] bg-[var(--ot-card)] px-3 py-1.5 text-[12px] font-medium hover:bg-[var(--ot-surface-3)]">
            Spender on explorer <span aria-hidden>↗</span>
          </a>
        ) : null}
      </div>
    </div>
  )
}

function Field({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn('flex min-w-0 flex-col gap-1', className)}>
      <span className="text-[10px] font-semibold tracking-[0.06em] text-[var(--ot-text-3)] uppercase">{label}</span>
      <span className="min-w-0">{children}</span>
    </div>
  )
}

/** The table while the first page is being read: the filters, then four rows of tide. */
export function ActivityTableSkeleton() {
  return (
    <section aria-busy className="overflow-hidden rounded-[18px] border border-[var(--ot-border)] bg-[var(--ot-card)]">
      <header className="flex items-center justify-between gap-3 px-4 pt-[18px] pb-3.5 sm:px-[22px]">
        <span className="flex gap-2">
          <Skeleton width={44} height={30} radius={999} />
          <Skeleton width={72} height={30} radius={999} delay={0.1} sweep={false} />
          <Skeleton width={64} height={30} radius={999} delay={0.2} sweep={false} />
        </span>
        <Skeleton width={120} height={34} radius={999} delay={0.3} sweep={false} />
      </header>
      <div className="flex flex-col">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="border-t border-[var(--ot-border)] px-4 py-3 sm:px-[22px]">
            <SkeletonRow avatar={34} label={i === 0 ? 'Reading your history' : null} className={cn(i >= 2 && 'opacity-60')} />
          </div>
        ))}
      </div>
    </section>
  )
}
