'use client'

import { useMemo } from 'react'
import type { Arm } from '@/lib/api'
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

export interface HoldingsProps {
  portfolio: SelectedPortfolio
  wallets?: readonly Arm[]
}

/**
 * Everything the linked wallets hold, in two kinds of section that never
 * share a row: the Wallet section, which is loose balances and nothing else,
 * and one card per protocol underneath, the way a portfolio app lays it out.
 * The network filter has already been applied to both by the time this
 * renders — every figure here is of the same slice.
 */
export function Holdings({ portfolio, wallets = [] }: HoldingsProps) {
  const chains = useMemo(() => new Map(portfolio.chains.map((chain) => [chain.chainId, chain])), [portfolio.chains])
  const walletRefs = useMemo(() => walletRefsOf(wallets), [wallets])
  const empty = portfolio.assets.length === 0 && portfolio.protocols.length === 0

  return (
    <div className="ot-scroll min-h-0 min-w-0 flex-1 space-y-3 overflow-y-auto overscroll-contain px-4 pt-3 pb-5 sm:px-6" tabIndex={0} aria-label="Holdings">
      {empty ? (
        <p className="ot-token-row py-8 text-center text-[13px] text-[var(--ot-text-2)]">No balances on this network.</p>
      ) : (
        <section aria-label="Wallet balances">
          <SectionHead icon={<WalletGlyph />} title="Wallet" value={portfolio.wallet.value} share={portfolio.wallet.share} unpriced={portfolio.wallet.unpriced} currency={portfolio.currency} />
          {portfolio.assets.length > 0 ? (
            <TokenTable rows={portfolio.assets} chains={portfolio.chains} currency={portfolio.currency} wallets={wallets} />
          ) : (
            <p className="ot-token-row py-6 text-center text-[13px] text-[var(--ot-text-2)]">Nothing loose in a wallet here — it is all in protocols.</p>
          )}
        </section>
      )}
      {portfolio.protocols.map((protocol) => (
        <ProtocolCard key={protocol.id} protocol={protocol} chains={chains} wallets={walletRefs} currency={portfolio.currency} />
      ))}
    </div>
  )
}
