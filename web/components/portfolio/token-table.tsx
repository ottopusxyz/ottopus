'use client'

import { useEffect, useMemo, useState } from 'react'
import { Button, Dialog } from '@/components/ui'
import type { Portfolio, AssetRow } from '@/lib/api'
import { cn } from '@/lib/cn'
import { formatAmount, formatMoneyFlat, formatShare } from '@/lib/format'
import { AssetIcon } from './asset-icon'
import { DetailPopover } from './detail-popover'
import { compactBalance, groupTokens, type TokenGroup } from './group-tokens'

/**
 * The asset column carries an icon, a symbol, a network strip and sometimes a
 * "held as" line, so it gets close to twice the width of a number. Share is the
 * narrowest: it is never longer than "100.0%".
 */
const COLUMNS = 'grid-cols-[minmax(0,1.25fr)_minmax(0,0.85fr)_minmax(0,0.8fr)] lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,0.55fr)_minmax(0,1fr)]'

/** One padding value for the header and every row, or the columns drift apart. */
const GUTTER = 'gap-2.5 px-2.5 sm:gap-5 sm:px-3.5'

export interface TokenTableProps {
  rows: readonly AssetRow[]
  chains: Portfolio['chains']
  currency?: string
}

function heldAs(row: TokenGroup): string | null {
  const away = row.holdings.filter((holding) => holding.positionType !== 'wallet')
  if (!away.length) return null
  if (row.holdings.every((holding) => holding.positionType === 'loan')) return 'Borrowed'
  const protocols = [...new Set(away.map((holding) => holding.protocol).filter(Boolean))]
  if (protocols.length === 1) return `In ${protocols[0]}`
  return protocols.length > 1 ? `In ${protocols.length} protocols` : 'In protocols'
}

const exactAmount = (amount: string, decimals: number) =>
  formatAmount(amount, decimals, { maxFractionDigits: decimals })

function Balance({ amount, decimals, symbol, label, subdued = false }: {
  amount: string; decimals: number; symbol: string; label: string; subdued?: boolean
}) {
  const exact = exactAmount(amount, decimals)
  const compact = compactBalance(amount, decimals) || formatAmount(amount, decimals, { maxFractionDigits: 4 })
  return (
    <DetailPopover label={`${label}: ${exact} ${symbol}`} className="block w-full text-right"
      title={label} detail={<p className="break-all font-mono leading-relaxed">{exact} {symbol}</p>}>
      <span className={cn('block truncate font-mono text-[12px] tabular-nums sm:text-[13px]', subdued ? 'text-[var(--ot-text-2)]' : 'font-medium')}>{compact}</span>
    </DetailPopover>
  )
}

export function TokenTable({ rows, chains, currency = 'usd' }: TokenTableProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const networks = useMemo(() => new Map(chains.map((chain) => [chain.chainId, chain])), [chains])
  const tokens = useMemo(() => groupTokens(rows), [rows])
  const selected = tokens.find((token) => token.id === selectedId)
  const selectedSymbol = selected?.asset.symbol || selected?.asset.name || 'Token'
  useEffect(() => {
    if (!selectedId || selected) return
    const reset = window.setTimeout(() => setSelectedId(null), 0)
    return () => window.clearTimeout(reset)
  }, [selectedId, selected])
  return (
    <>
    <div className="flex min-h-0 min-w-0 flex-1 flex-col px-4 tabular-nums sm:px-6" role="table" aria-label="Token holdings">
      <div role="row" className={`ot-scroll-gutter grid ${COLUMNS} ${GUTTER} shrink-0 pt-3 pb-2 text-[10px] font-semibold tracking-[0.06em] text-[var(--ot-text-2)] uppercase`}>
        <span role="columnheader">Asset</span>
        <span role="columnheader" className="text-right">Balance</span>
        <span role="columnheader" className="hidden text-right lg:block">Spendable</span>
        <span role="columnheader" className="hidden text-right lg:block">Share</span>
        <span role="columnheader" className="text-right">Value</span>
      </div>
      <div role="rowgroup" aria-label="Assets" tabIndex={0}
        className="ot-scroll min-h-0 flex-1 space-y-2 overflow-y-auto overscroll-contain pb-5">
      {tokens.map((token) => {
        const held = heldAs(token)
        const symbol = token.asset.symbol || token.asset.name
        return (
          <div role="row" key={token.id} className={`ot-token-row grid ${COLUMNS} ${GUTTER} items-center py-2.5 transition-colors`}>
            <div role="cell" className="flex min-w-0 items-start gap-2.5 sm:gap-3">
              <AssetIcon url={token.asset.iconUrl} name={symbol} size={36} />
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <div className="flex min-w-0 items-center gap-1.5">
                  <span title={token.asset.name} className="truncate text-[13px] font-semibold sm:text-[14px]">{symbol}</span>
                  {!token.asset.verified ? (
                    <DetailPopover label="Unverified token" className="shrink-0 text-[var(--ot-text-3)] hover:text-[var(--ot-warn-text)]"
                      title="Unverified token"
                      detail={<p className="leading-relaxed text-[var(--ot-text-2)]">The data provider has not verified this token’s identity.</p>}>
                      <svg aria-hidden viewBox="0 0 16 16" className="h-3.5 w-3.5"><path d="m8 1.5 6 3v4c0 3-6 6-6 6s-6-3-6-6v-4l6-3Z" fill="none" stroke="currentColor" strokeWidth="1.2" /><path d="M8 5v3.5M8 11h.01" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
                    </DetailPopover>
                  ) : null}
                </div>
                <button type="button" aria-haspopup="dialog"
                  aria-label={`View ${symbol} breakdown across ${token.networks.length} network${token.networks.length === 1 ? '' : 's'}`}
                  onClick={() => setSelectedId(token.id)}
                  className="-ml-1 flex w-fit max-w-full cursor-pointer items-center gap-1.5 rounded-full px-1 py-0.5 text-[10px] text-[var(--ot-text-3)] transition-colors hover:bg-[var(--ot-surface-2)] hover:text-[var(--ot-text)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ot-plan)]">
                  <span aria-hidden className="isolate flex -space-x-1">
                    {token.networks.slice(0, 4).map((balance, index) => {
                      const chain = networks.get(balance.chainId)
                      return <span key={balance.chainId} className="relative" style={{ zIndex: 4 - index }}>
                        <AssetIcon url={chain?.iconUrl} name={chain?.name ?? 'Unknown network'} size={14} className="ring-2 ring-[var(--ot-card)]" />
                      </span>
                    })}
                  </span>
                  {token.networks.length > 4 ? <span aria-hidden className="font-medium">+{token.networks.length - 4}</span> : null}
                </button>
                {held ? <span title={held} className="truncate text-[10px] text-[var(--ot-text-3)]">{held}</span> : null}
              </div>
            </div>
            <div role="cell" className="min-w-0 space-y-1">
              <Balance amount={token.amount} decimals={token.asset.decimals} symbol={symbol} label="Total balance" />
              <div className="lg:hidden">
                <span className="block text-right text-[9px] text-[var(--ot-text-3)]">Spendable</span>
                <Balance amount={token.spendable} decimals={token.asset.decimals} symbol={symbol} label="Spendable balance" subdued />
              </div>
            </div>
            <div role="cell" className="hidden min-w-0 lg:block"><Balance amount={token.spendable} decimals={token.asset.decimals} symbol={symbol} label="Spendable balance" subdued /></div>
            <span role="cell" className="hidden text-right text-[12px] text-[var(--ot-text-2)] lg:block">{formatShare(token.share)}</span>
            <div role="cell" className="min-w-0">
              <DetailPopover label={token.priced ? `Value: ${formatMoneyFlat(token.value, currency)}` : 'Price unavailable'} className="block w-full text-right"
                title={token.priced ? 'Value' : undefined}
                detail={<p className="break-all font-mono">{token.priced ? formatMoneyFlat(token.value, currency) : 'Price unavailable'}</p>}>
                <span className={cn('block truncate font-mono text-[12px] font-medium sm:text-[13px]', token.value < 0 && 'text-[var(--ot-warn-text)]')}>
                  {token.priced ? formatMoneyFlat(token.value, currency) : '—'}
                </span>
              </DetailPopover>
              <span className="mt-1 block text-right text-[10px] text-[var(--ot-text-3)] lg:hidden">{formatShare(token.share)}</span>
            </div>
          </div>
        )
      })}
      {tokens.length === 0 ? (
        <p className="ot-token-row py-8 text-center text-[13px] text-[var(--ot-text-2)]">No balances on this network.</p>
      ) : null}
      </div>
    </div>
    <Dialog open={!!selected} onClose={() => setSelectedId(null)}
      title={`${selectedSymbol} breakdown`}
      description={selected ? `Balances across ${selected.networks.length} network${selected.networks.length === 1 ? '' : 's'} in the current view.` : undefined}
      className="[&_.ot-dialog-panel]:max-h-[85dvh] [&_.ot-dialog-panel]:overflow-hidden sm:[&_.ot-dialog-panel]:w-[min(460px,calc(100vw-2rem))]"
      actions={<Button variant="secondary" size="sm" onClick={() => setSelectedId(null)}>Close</Button>}>
      {selected ? (
        <div className="flex items-center gap-3 rounded-[var(--ot-radius-md)] border border-[var(--ot-border)] bg-[var(--ot-surface-2)] px-3.5 py-3">
          <AssetIcon url={selected.asset.iconUrl} name={selectedSymbol} size={40} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[14px] font-semibold">{selectedSymbol}</p>
            <p className="truncate text-[12px] text-[var(--ot-text-3)]">{selected.asset.name}</p>
          </div>
          <div className="shrink-0 text-right tabular-nums">
            <p className="font-mono text-[14px] font-semibold">
              {selected.priced ? formatMoneyFlat(selected.value, currency) : '—'}
            </p>
            <p className="font-mono text-[11px] text-[var(--ot-text-3)]">{formatShare(selected.share)} of holdings</p>
          </div>
        </div>
      ) : null}
      <div className="ot-scroll min-h-0 space-y-2 overflow-y-auto overscroll-contain tabular-nums" aria-label="Network balances" tabIndex={0}>
        {selected?.networks.map((balance) => {
          const chain = networks.get(balance.chainId)
          return (
            <section key={balance.chainId} className="rounded-[var(--ot-radius-md)] border border-[var(--ot-border)] px-3.5 py-3">
              <header className="mb-2.5 flex items-center gap-2.5">
                <AssetIcon url={chain?.iconUrl} name={chain?.name ?? 'Unknown network'} size={22} />
                <h3 className="min-w-0 flex-1 truncate text-[13px] font-semibold">{chain?.name ?? 'Unknown network'}</h3>
                <span className={cn('shrink-0 font-mono text-[13px] font-medium', balance.value < 0 && 'text-[var(--ot-warn-text)]')}>
                  {balance.priced ? formatMoneyFlat(balance.value, currency) : 'No price'}
                </span>
              </header>
              <dl className="grid grid-cols-[auto_minmax(0,1fr)] items-baseline gap-x-4 gap-y-1.5 text-[12px]">
                <dt className="text-[var(--ot-text-3)]">Balance</dt>
                <dd className="min-w-0 text-right break-all font-mono">{exactAmount(balance.amount, selected.asset.decimals)} {selectedSymbol}</dd>
                <dt className="text-[var(--ot-text-3)]">Spendable</dt>
                <dd className="min-w-0 text-right break-all font-mono text-[var(--ot-text-2)]">{exactAmount(balance.spendable, selected.asset.decimals)} {selectedSymbol}</dd>
              </dl>
            </section>
          )
        })}
      </div>
    </Dialog>
    </>
  )
}
