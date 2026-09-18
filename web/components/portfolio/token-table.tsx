'use client'

import { useEffect, useMemo, useState } from 'react'
import { Button, Dialog } from '@/components/ui'
import { armName, walletMark } from '@/components/wallets/naming'
import type { Arm, Portfolio, AssetRow } from '@/lib/api'
import { cn } from '@/lib/cn'
import { formatAmount, formatMoneyFlat, formatShare } from '@/lib/format'
import { AssetIcon } from './asset-icon'
import { DetailPopover } from './detail-popover'
import { compactBalance, groupTokens, type TokenGroup } from './group-tokens'

/**
 * The asset column carries an icon, a symbol, a network strip and sometimes a
 * "held as" line, so it gets close to twice the width of a number. Balance is
 * next widest because it carries the wallet marks beside the figure. Share is
 * the narrowest: it is never longer than "100.0%".
 *
 * No spendable column. It was a second number a glance could not tell from
 * the first; the breakdown has it, per network, where the difference means
 * something.
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

/** What a row knows about a wallet: enough to name it and draw it. */
interface WalletRef {
  id: string
  name: string
  icon: string | null
  /** Set by the person, so its first letter stands for it. */
  label: string | null
  watchOnly: boolean
}

/**
 * A wallet's mark, in three forms: the client's bundled mark (public/wallets,
 * keyed by the type stored on the arm — the same on every device); an eye for
 * a watch-only address, because "watched, not held" is the fact about it that
 * matters, whatever it is called; else the first letter of its name, for a
 * client we have no mark for. One glyph per circle — AssetIcon's two-letter
 * fallback sat off the baseline beside real images and read as a ticker.
 */
function WalletMark({ wallet, size, className }: { wallet: WalletRef; size: number; className?: string }) {
  const eye = wallet.watchOnly
  if (wallet.icon && !eye) return <AssetIcon url={wallet.icon} name={wallet.name} size={size} className={className} />
  return (
    <span aria-hidden style={{ width: size, height: size }}
      className={cn('inline-flex shrink-0 items-center justify-center rounded-full bg-[var(--ot-surface-3)] font-semibold leading-none text-[var(--ot-text-2)] ring-1 ring-[var(--ot-border)]', className)}>
      {eye ? (
        <svg viewBox="0 0 16 16" width={size * 0.7} height={size * 0.7} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          <path d="M1.6 8s2.4-4 6.4-4 6.4 4 6.4 4-2.4 4-6.4 4S1.6 8 1.6 8Z" />
          <circle cx="8" cy="8" r="1.6" />
        </svg>
      ) : (
        <span style={{ fontSize: Math.round(size * 0.55) }}>{(wallet.label ?? wallet.name).trim().charAt(0).toUpperCase()}</span>
      )}
    </span>
  )
}

/**
 * The wallets holding some part of a token, most first, summed across position
 * types — a wallet with 1 ETH loose and 0.5 staked holds 1.5 here.
 */
function holdersOf(
  holdings: readonly { walletId: string; amount: string }[],
  lookup: ReadonlyMap<string, WalletRef>,
): (WalletRef & { amount: bigint })[] {
  const sums = new Map<string, bigint>()
  for (const holding of holdings) {
    sums.set(holding.walletId, (sums.get(holding.walletId) ?? 0n) + BigInt(holding.amount))
  }
  return [...sums]
    .sort((a, b) => (b[1] > a[1] ? 1 : b[1] < a[1] ? -1 : 0))
    .map(([id, amount]) => ({
      ...(lookup.get(id) ?? { id, name: 'Unlinked wallet', icon: null, label: null, watchOnly: false }),
      amount,
    }))
}

/**
 * Who holds it, beside the balance: the wallets' own marks, overlapping the
 * way the network strip does. The names ride on the title and for a screen
 * reader; the words are in the breakdown, where there is room for them.
 */
function WalletMarks({ holders }: { holders: readonly WalletRef[] }) {
  if (holders.length === 0) return null
  const names = holders.map((wallet) => wallet.name)
  const extra = holders.length - 3
  return (
    <span
      title={names.join(', ')}
      aria-label={`Held in ${names.join(', ')}`}
      className="isolate flex shrink-0 items-center -space-x-1"
    >
      {holders.slice(0, 3).map((wallet, index) => (
        <span key={wallet.id} className="relative" style={{ zIndex: 3 - index }}>
          <WalletMark wallet={wallet} size={16} className="ring-2 ring-[var(--ot-card)]" />
        </span>
      ))}
      {extra > 0 ? (
        <span className="relative z-0 ml-1 pl-1.5 text-[10px] font-medium text-[var(--ot-text-3)]">+{extra}</span>
      ) : null}
    </span>
  )
}

/** Six places, grouped — what a person reads. The exact figure rides on the title. */
const pretty = (amount: string, decimals: number) =>
  formatAmount(amount, decimals, { maxFractionDigits: 6 })

/** Keeps a click on a number's tooltip from also opening the row. */
const stop = (event: { stopPropagation(): void }) => event.stopPropagation()

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
  const walletRefs = useMemo(
    () => new Map<string, WalletRef>(wallets.map((arm) => [
      arm.id,
      {
        id: arm.id,
        name: armName(arm),
        icon: walletMark(arm.walletType),
        label: arm.label,
        watchOnly: arm.isWatchOnly,
      },
    ])),
    [wallets],
  )
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
        <span role="columnheader" className="hidden text-right lg:block">Share</span>
        <span role="columnheader" className="text-right">Value</span>
      </div>
      <div role="rowgroup" aria-label="Assets" tabIndex={0}
        className="ot-scroll min-h-0 flex-1 space-y-2 overflow-y-auto overscroll-contain pb-5">
      {tokens.map((token) => {
        const held = heldAs(token)
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
                {held ? <span title={held} className="truncate text-[10px] text-[var(--ot-text-3)]">{held}</span> : null}
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
                <dd title={`${exactAmount(balance.amount, selected.asset.decimals)} ${selectedSymbol}`} className="min-w-0 truncate text-right font-mono font-medium">
                  {pretty(balance.amount, selected.asset.decimals)} {selectedSymbol}
                </dd>
                <dt className="text-[var(--ot-text-3)]">Spendable</dt>
                <dd title={`${exactAmount(balance.spendable, selected.asset.decimals)} ${selectedSymbol}`} className="min-w-0 truncate text-right font-mono text-[var(--ot-text-2)]">
                  {pretty(balance.spendable, selected.asset.decimals)} {selectedSymbol}
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
