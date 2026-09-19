'use client'

import { useEffect, useMemo, useState } from 'react'
import { Button, Dialog } from '@/components/ui'
import type { Arm, Portfolio, AssetRow } from '@/lib/api'
import { formatAmount, formatMoneyFlat, formatShare } from '@/lib/format'
import { AssetIcon } from './asset-icon'
import { DetailPopover } from './detail-popover'
import { compactBalance, groupTokens } from './group-tokens'
import { WalletMark, WalletMarks, holdersOf, walletRefsOf } from './wallet-marks'

/**
 * The asset column carries an icon, a symbol and a network strip, so it gets
 * close to twice the width of a number. Balance is next widest because it
 * carries the wallet marks beside the figure. Share is the narrowest: it is
 * never longer than "100.0%".
 *
 * Every row here is loose in a wallet — what is deposited, staked or borrowed
 * is under its protocol, so nothing in this table is ever negative and every
 * balance is one a plan could spend.
 */
const COLUMNS = 'grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,0.75fr)] lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1.2fr)_minmax(0,0.55fr)_minmax(0,1fr)]'

/** One padding value for the header and every row, or the columns drift apart. */
const GUTTER = 'gap-2.5 px-2.5 sm:gap-5 sm:px-3.5'

export interface TokenTableProps {
  rows: readonly AssetRow[]
  chains: Portfolio['chains']
  currency?: string
  /** The arms, so a holding's walletId becomes a name and a mark. */
  wallets?: readonly Arm[]
}

/** Six places, grouped — what a person reads. The exact figure rides on the title. */
const pretty = (amount: string, decimals: number) =>
  formatAmount(amount, decimals, { maxFractionDigits: 6 })

/** Keeps a click on a number's tooltip from also opening the row. */
const stop = (event: { stopPropagation(): void }) => event.stopPropagation()

const exactAmount = (amount: string, decimals: number) =>
  formatAmount(amount, decimals, { maxFractionDigits: decimals })

function Balance({ amount, decimals, symbol, label }: {
  amount: string; decimals: number; symbol: string; label: string
}) {
  const exact = exactAmount(amount, decimals)
  const compact = compactBalance(amount, decimals) || formatAmount(amount, decimals, { maxFractionDigits: 4 })
  return (
    <DetailPopover label={`${label}: ${exact} ${symbol}`} className="block min-w-0 text-right"
      title={label} detail={<p className="break-all font-mono leading-relaxed">{exact} {symbol}</p>}>
      <span className="block truncate font-mono text-[12px] font-medium tabular-nums sm:text-[13px]">{compact}</span>
    </DetailPopover>
  )
}

export function TokenTable({ rows, chains, currency = 'usd', wallets = [] }: TokenTableProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const networks = useMemo(() => new Map(chains.map((chain) => [chain.chainId, chain])), [chains])
  const walletRefs = useMemo(() => walletRefsOf(wallets), [wallets])
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
    <div className="min-w-0 tabular-nums" role="table" aria-label="Token holdings">
      <div role="row" className={`grid ${COLUMNS} ${GUTTER} pt-1 pb-2 text-[10px] font-semibold tracking-[0.06em] text-[var(--ot-text-2)] uppercase`}>
        <span role="columnheader">Asset</span>
        <span role="columnheader" className="text-right">Balance</span>
        <span role="columnheader" className="hidden text-right lg:block">Share</span>
        <span role="columnheader" className="text-right">Value</span>
      </div>
      <div role="rowgroup" aria-label="Assets" className="space-y-2">
      {tokens.map((token) => {
        const symbol = token.asset.symbol || token.asset.name
        return (
          // The row is the target — the strip of network marks was too small a
          // thing to be the only way in. It keeps its button for the keyboard
          // and for the label a screen reader needs; a click there stops short
          // of the row so the dialog is not asked to open twice.
          <div role="row" key={token.id} onClick={() => setSelectedId(token.id)}
            className={`ot-token-row grid ${COLUMNS} ${GUTTER} cursor-pointer items-center py-2.5 transition-colors`}>
            <div role="cell" className="flex min-w-0 items-start gap-2.5 sm:gap-3">
              <AssetIcon url={token.asset.iconUrl} name={symbol} size={36} />
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <div className="flex min-w-0 items-center gap-1.5">
                  <span title={token.asset.name} className="truncate text-[13px] font-semibold sm:text-[14px]">{symbol}</span>
                  {!token.asset.verified ? (
                    <span onClick={stop} className="contents">
                    <DetailPopover label="Unverified token" className="shrink-0 text-[var(--ot-text-3)] hover:text-[var(--ot-warn-text)]"
                      title="Unverified token"
                      detail={<p className="leading-relaxed text-[var(--ot-text-2)]">The data provider has not verified this token’s identity.</p>}>
                      <svg aria-hidden viewBox="0 0 16 16" className="h-3.5 w-3.5"><path d="m8 1.5 6 3v4c0 3-6 6-6 6s-6-3-6-6v-4l6-3Z" fill="none" stroke="currentColor" strokeWidth="1.2" /><path d="M8 5v3.5M8 11h.01" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
                    </DetailPopover>
                    </span>
                  ) : null}
                </div>
                <button type="button" aria-haspopup="dialog"
                  aria-label={`View ${symbol} breakdown across ${token.networks.length} network${token.networks.length === 1 ? '' : 's'}`}
                  onClick={(event) => { stop(event); setSelectedId(token.id) }}
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
              </div>
            </div>
            <div role="cell" onClick={stop} className="flex min-w-0 items-center justify-end gap-2">
              <WalletMarks holders={holdersOf(token.holdings, walletRefs)} />
              <Balance amount={token.amount} decimals={token.asset.decimals} symbol={symbol} label="Total balance" />
            </div>
            <span role="cell" className="hidden text-right text-[12px] text-[var(--ot-text-2)] lg:block">{formatShare(token.share)}</span>
            <div role="cell" onClick={stop} className="min-w-0">
              <DetailPopover label={token.priced ? `Value: ${formatMoneyFlat(token.value, currency)}` : 'Price unavailable'} className="block w-full text-right"
                title={token.priced ? 'Value' : undefined}
                detail={<p className="break-all font-mono">{token.priced ? formatMoneyFlat(token.value, currency) : 'Price unavailable'}</p>}>
                <span className="block truncate font-mono text-[12px] font-medium sm:text-[13px]">
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
                <span className="shrink-0 font-mono text-[13px] font-medium">
                  {balance.priced ? formatMoneyFlat(balance.value, currency) : 'No price'}
                </span>
              </header>
              <dl className="grid grid-cols-[auto_minmax(0,1fr)] items-baseline gap-x-4 gap-y-1.5 text-[12px]">
                <dt className="text-[var(--ot-text-3)]">Balance</dt>
                <dd title={`${exactAmount(balance.amount, selected.asset.decimals)} ${selectedSymbol}`} className="min-w-0 truncate text-right font-mono font-medium">
                  {pretty(balance.amount, selected.asset.decimals)} {selectedSymbol}
                </dd>
              </dl>
              {/* Which wallets, on this network. The section's balance is their
                  sum, and the one a transfer would come from is one of these. */}
              <ul className="mt-2.5 flex list-none flex-col gap-1.5 border-t border-[var(--ot-border)] p-0 pt-2.5">
                {holdersOf(selected.holdings.filter((holding) => holding.chainId === balance.chainId), walletRefs).map((wallet) => (
                  <li key={wallet.id} className="flex items-center gap-2 text-[12px]">
                    <WalletMark wallet={wallet} size={18} />
                    <span className="min-w-0 flex-1 truncate">{wallet.name}</span>
                    <span title={`${exactAmount(wallet.amount.toString(), selected.asset.decimals)} ${selectedSymbol}`} className="shrink-0 font-mono text-[var(--ot-text-2)]">
                      {pretty(wallet.amount.toString(), selected.asset.decimals)} {selectedSymbol}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )
        })}
      </div>
    </Dialog>
    </>
  )
}
