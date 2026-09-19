'use client'

import type { ReactNode } from 'react'
import { Badge } from '@/components/ui'
import type { PositionGroup, ProtocolHolding, ProtocolRow } from '@/lib/api'
import { cn } from '@/lib/cn'
import { formatAmount, formatMoneyFlat, formatShare } from '@/lib/format'
import { AssetIcon } from './asset-icon'
import { DetailPopover } from './detail-popover'
import { compactBalance } from './group-tokens'
import { groupKind, heldTag } from './protocol-labels'
import { WalletMark, walletRefOf, type WalletRef } from './wallet-marks'

/** The same three-then-four column grid as the token table, so the two read as one list. */
const COLUMNS = 'grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,0.75fr)] lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1.2fr)_minmax(0,0.55fr)_minmax(0,1fr)]'
const GUTTER = 'gap-2.5 px-2.5 sm:gap-5 sm:px-3.5'

/** "1 holding has no price" — the title behind a partial figure. */
export function unpricedNote(count: number): string {
  return `${count} holding${count === 1 ? ' has' : 's have'} no price, so this figure leaves ${count === 1 ? 'it' : 'them'} out`
}

/** A small amber mark that a figure is a floor, not the whole. */
function PartialBadge({ unpriced }: { unpriced: number }) {
  return (
    <Badge tone="warn" title={unpricedNote(unpriced)} className="cursor-help px-2 py-0.5 text-[11px]">
      Partial
    </Badge>
  )
}

/**
 * The line that opens a section: what it is, what it is worth, and how much
 * of the whole that is. The wallet section and every protocol card share it,
 * so "Wallet · $760" and "Fluid · $1,898" sit on the same baseline.
 *
 * With an unpriced holding in it the figure is a floor: it stays in the
 * ordinary colour, carries a Partial mark, and is never called net debt —
 * debt against collateral of unknown value is unknown, not negative.
 */
export function SectionHead({ icon, title, value, share, change, unpriced = 0, currency = 'usd', href }: {
  icon: ReactNode
  title: string
  value: number
  share: number
  change?: number
  unpriced?: number
  currency?: string
  href?: string | null
}) {
  const partial = unpriced > 0
  return (
    <header className="flex min-w-0 items-center gap-2.5 px-1 py-2">
      {icon}
      <h2 className="min-w-0 truncate text-[14px] font-semibold sm:text-[15px]">{title}</h2>
      <span aria-hidden className="text-[var(--ot-text-3)]">·</span>
      <span title={partial ? unpricedNote(unpriced) : undefined}
        className={cn('shrink-0 font-mono text-[14px] font-semibold tabular-nums sm:text-[15px]', value < 0 && !partial && 'text-[var(--ot-block-text)]')}>
        {formatMoneyFlat(value, currency)}
      </span>
      {partial ? (
        <PartialBadge unpriced={unpriced} />
      ) : share > 0 ? (
        <Badge tone="neutral" className="px-2 py-0.5 text-[11px]">{formatShare(share)}</Badge>
      ) : value < 0 ? (
        <Badge tone="block" className="px-2 py-0.5 text-[11px]">Net debt</Badge>
      ) : null}
      {change !== undefined && Math.abs(change) >= 0.005 ? (
        <span className={cn('hidden font-mono text-[11px] tabular-nums sm:inline', change > 0 ? 'text-[var(--ot-ok-text)]' : 'text-[var(--ot-block-text)]')}>
          {change > 0 ? '+' : '−'}{formatMoneyFlat(Math.abs(change), currency)}
        </span>
      ) : null}
      <span className="flex-1" />
      {href ? (
        <a href={href} target="_blank" rel="noreferrer noopener"
          aria-label={`Open ${title} in a new tab`}
          className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[var(--ot-text-3)] transition-colors hover:bg-[var(--ot-surface-2)] hover:text-[var(--ot-text-1)]">
          <svg aria-hidden viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
            <path d="M6 3H3.5A1.5 1.5 0 0 0 2 4.5v8A1.5 1.5 0 0 0 3.5 14h8a1.5 1.5 0 0 0 1.5-1.5V10" />
            <path d="M9 2h5v5M14 2 7.5 8.5" />
          </svg>
        </a>
      ) : null}
    </header>
  )
}

/** The app's own mark, or its initial in a circle when it has none. */
function ProtocolMark({ protocol, size }: { protocol: Pick<ProtocolRow, 'name' | 'iconUrl'>; size: number }) {
  return <AssetIcon url={protocol.iconUrl} name={protocol.name} size={size} className="rounded-[8px]" />
}

const exactAmount = (amount: string, decimals: number) =>
  formatAmount(amount, decimals, { maxFractionDigits: decimals })

function Row({ holding, module, chain, wallet, currency }: {
  holding: ProtocolHolding
  module: PositionGroup['module']
  chain: { name: string; iconUrl?: string | null } | undefined
  wallet: WalletRef
  currency: string
}) {
  const symbol = holding.asset.symbol || holding.asset.name
  const tag = heldTag(holding.positionType, module)
  const exact = exactAmount(holding.amount, holding.asset.decimals)
  const compact = compactBalance(holding.amount, holding.asset.decimals)
    || formatAmount(holding.amount, holding.asset.decimals, { maxFractionDigits: 4 })
  const priced = holding.value !== null
  const debt = holding.positionType === 'loan'

  return (
    <div role="row" className={`grid ${COLUMNS} ${GUTTER} items-center py-2.5`}>
      <div role="cell" className="flex min-w-0 items-center gap-2.5 sm:gap-3">
        <AssetIcon url={holding.asset.iconUrl} name={symbol} size={32} />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <span title={holding.asset.name} className="truncate text-[13px] font-semibold sm:text-[14px]">{symbol}</span>
          <span className="flex min-w-0 items-center gap-1.5 text-[10px] text-[var(--ot-text-3)]">
            <AssetIcon url={chain?.iconUrl} name={chain?.name ?? 'Unknown network'} size={12} />
            <span className="truncate">{chain?.name ?? holding.chainId}</span>
            <span aria-hidden>·</span>
            <Badge tone={tag.tone} className="px-1.5 py-[2px] text-[10px]">{tag.label}</Badge>
          </span>
        </div>
      </div>
      <div role="cell" className="flex min-w-0 items-center justify-end gap-2">
        <span title={wallet.name} aria-label={`In ${wallet.name}`} className="shrink-0">
          <WalletMark wallet={wallet} size={16} className="ring-2 ring-[var(--ot-card)]" />
        </span>
        <DetailPopover label={`${tag.label}: ${exact} ${symbol}`} className="block min-w-0 text-right"
          title={tag.label} detail={<p className="break-all font-mono leading-relaxed">{exact} {symbol}</p>}>
          <span className="block truncate font-mono text-[12px] font-medium tabular-nums sm:text-[13px]">{compact}</span>
        </DetailPopover>
      </div>
      <span role="cell" className="hidden lg:block" />
      <div role="cell" className="min-w-0">
        <DetailPopover label={priced ? `${debt ? 'Owed' : 'Value'}: ${formatMoneyFlat(holding.value!, currency)}` : 'Price unavailable'}
          className="block w-full text-right" title={priced ? (debt ? 'Owed' : 'Value') : undefined}
          detail={<p className="break-all font-mono">{priced ? formatMoneyFlat(holding.value!, currency) : 'Price unavailable'}</p>}>
          <span className={cn('block truncate font-mono text-[12px] font-medium sm:text-[13px]', debt && 'text-[var(--ot-block-text)]')}>
            {priced ? `${debt ? '−' : ''}${formatMoneyFlat(holding.value!, currency)}` : '—'}
          </span>
        </DetailPopover>
      </div>
    </div>
  )
}

export interface ProtocolCardProps {
  protocol: ProtocolRow
  chains: ReadonlyMap<string, { name: string; iconUrl?: string | null }>
  wallets: ReadonlyMap<string, WalletRef>
  currency?: string
}

/**
 * One app, the way the app itself shows it: a header with the net figure,
 * then each market, pool or vault as a group, then the assets inside it with
 * a tag for how each is held. Debt is a row with a "Debt" tag and a minus on
 * its value — inside the card that owes it, never a negative token balance.
 */
export function ProtocolCard({ protocol, chains, wallets, currency = 'usd' }: ProtocolCardProps) {
  return (
    <section aria-label={`${protocol.name} positions`} className="ot-token-row px-1 pt-0.5 pb-1">
      <SectionHead
        icon={<ProtocolMark protocol={protocol} size={24} />}
        title={protocol.name}
        value={protocol.value}
        share={protocol.share}
        change={protocol.change1d}
        unpriced={protocol.unpriced}
        currency={currency}
        href={protocol.url}
      />
      {protocol.groups.map((group) => {
        const kind = groupKind(group)
        const chain = chains.get(group.chainId)
        return (
          <div key={`${group.chainId} ${group.id}`} role="table" aria-label={group.name} className="mt-1 tabular-nums">
            <div role="row" className={`flex items-center ${GUTTER} pt-2 pb-1 text-[10px] font-semibold tracking-[0.06em] text-[var(--ot-text-2)] uppercase`}>
              <span role="columnheader" className="min-w-0 truncate">{group.name}</span>
              {kind ? <span role="columnheader" className="shrink-0 font-medium normal-case tracking-normal text-[var(--ot-text-3)]">{kind}</span> : null}
              <span className="flex-1" />
              {group.unpriced > 0 ? (
                <span role="columnheader" title={unpricedNote(group.unpriced)} className="shrink-0 cursor-help font-medium normal-case tracking-normal text-[var(--ot-warn-text)]">
                  Partial
                </span>
              ) : null}
              <span role="columnheader" title={group.unpriced > 0 ? unpricedNote(group.unpriced) : undefined}
                className={cn('shrink-0 font-mono tracking-normal', group.value < 0 && group.unpriced === 0 && 'text-[var(--ot-block-text)]')}>
                {formatMoneyFlat(group.value, currency)}
              </span>
            </div>
            <div role="rowgroup">
              {group.holdings.map((holding, i) => (
                <Row key={`${holding.walletId} ${holding.assetId} ${holding.positionType} ${i}`}
                  holding={holding} module={group.module} chain={chain}
                  wallet={walletRefOf(wallets, holding.walletId)} currency={currency} />
              ))}
            </div>
          </div>
        )
      })}
    </section>
  )
}
