'use client'

import { useMemo } from 'react'
import type { Arm } from '@/lib/api'
import { cn } from '@/lib/cn'
import { ProtocolCard, SectionHead } from './protocol-card'
import type { SelectedPortfolio } from './select-portfolio'
import { TokenTable } from './token-table'
import { walletRefsOf } from './wallet-marks'

/** The wallet section's mark: a plain wallet glyph, the size of an app's icon. */
function WalletGlyph() {
  return (
    <span aria-hidden className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-[8px] bg-[var(--ot-plan-bg)] text-[var(--ot-plan-text)]">
      <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
        <path d="M2 5.5A1.5 1.5 0 0 1 3.5 4h9A1.5 1.5 0 0 1 14 5.5v6a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 11.5v-6Z" />
        <path d="M2 7h12M10.5 9.5h1.5" />
      </svg>
    </span>
  )
}

/** A DeFi glyph for the rail's section head: layered coins, the size of an app's icon. */
function DefiGlyph() {
  return (
    <span aria-hidden className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-[8px] bg-[var(--ot-ok-bg)] text-[var(--ot-ok-text)]">
      <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
        <ellipse cx="8" cy="4.5" rx="5" ry="2" />
        <path d="M3 4.5v3c0 1.1 2.2 2 5 2s5-.9 5-2v-3M3 7.5v3c0 1.1 2.2 2 5 2s5-.9 5-2v-3" />
      </svg>
    </span>
  )
}

export interface HoldingsProps {
  portfolio: SelectedPortfolio
  wallets?: readonly Arm[]
  /**
   * What to draw. `all` is the one column a phone or a laptop gets. `wallet`
   * and `defi` are the two halves of the wide layout, where the protocols
   * move into the rail beside the tokens; `wallet` still draws the protocols
   * below xl, because there the rail does not exist.
   */
  show?: 'all' | 'wallet' | 'defi'
}

/**
 * Everything the linked wallets hold, in two kinds of section that never
 * share a row: the Wallet section, which is loose balances and nothing else,
 * and one card per protocol underneath, the way a portfolio app lays it out.
 * The network filter has already been applied to both by the time this
 * renders — every figure here is of the same slice.
 */
export function Holdings({ portfolio, wallets = [], show = 'all' }: HoldingsProps) {
  const chains = useMemo(() => new Map(portfolio.chains.map((chain) => [chain.chainId, chain])), [portfolio.chains])
  const walletRefs = useMemo(() => walletRefsOf(wallets), [wallets])
  const empty = portfolio.assets.length === 0 && portfolio.protocols.length === 0
  const cards = portfolio.protocols.map((protocol) => (
    <ProtocolCard key={protocol.id} protocol={protocol} chains={chains} wallets={walletRefs} currency={portfolio.currency} />
  ))

  if (show === 'defi') {
    const value = portfolio.protocols.reduce((sum, app) => sum + app.value, 0)
    const share = portfolio.protocols.reduce((sum, app) => sum + app.share, 0)
    const change = portfolio.protocols.reduce((sum, app) => sum + app.change1d, 0)
    return (
      <div className="@container min-w-0 flex-1 space-y-3 px-3 pt-3 pb-5" aria-label="DeFi positions">
        <section aria-label="DeFi">
          <SectionHead icon={<DefiGlyph />} title="DeFi" value={value} share={share} change={change} currency={portfolio.currency} />
          {/* The token table's column header, in shape, so the first card sits level with the first row. */}
          <div aria-hidden className="flex justify-between px-2.5 pt-1 pb-2 text-[10px] font-semibold tracking-[0.06em] text-[var(--ot-text-2)] uppercase sm:px-3.5">
            <span>Protocol</span>
            <span>Value</span>
          </div>
          <div className="space-y-3">{cards}</div>
        </section>
      </div>
    )
  }

  return (
    <div className="@container min-w-0 flex-1 space-y-3 px-4 pt-3 pb-5 sm:px-6" aria-label="Holdings">
      {empty ? (
        <p className="ot-token-row py-8 text-center text-[13px] text-[var(--ot-text-2)]">No balances on this network.</p>
      ) : (
        <section aria-label="Wallet balances">
          <SectionHead icon={<WalletGlyph />} title="Wallet" value={portfolio.wallet.value} share={portfolio.wallet.share} currency={portfolio.currency} />
          {portfolio.assets.length > 0 ? (
            <TokenTable rows={portfolio.assets} chains={portfolio.chains} currency={portfolio.currency} wallets={wallets} />
          ) : (
            <p className="ot-token-row py-6 text-center text-[13px] text-[var(--ot-text-2)]">Nothing loose in a wallet here — it is all in protocols.</p>
          )}
        </section>
      )}
      {/* When the rail carries the protocols, the column keeps them only where there is no rail. */}
      <div className={cn('space-y-3', show === 'wallet' && 'xl:hidden')}>{cards}</div>
    </div>
  )
}
