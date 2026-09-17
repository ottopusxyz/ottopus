'use client'

import { useSearchParams } from 'next/navigation'
import { useMemo, useState } from 'react'
import { usePrivyAvailable } from '@/components/auth'
import { Otto } from '@/components/brand'
import { BubbleField, SeaLife } from '@/components/motion'
import { SkeletonShelf } from '@/components/motion/loaders'
import { Figure, FirstIntentNudge, PageHeader, TabBar } from '@/components/shell'
import { Button, Callout, EmptyState } from '@/components/ui'
import {
  ArmCard,
  LinkWalletDialog,
  MAX_ARMS,
  armsOf,
  failureText,
  useWallets,
  type WalletsFailure,
} from '@/components/wallets'
import type { Arm } from '@/lib/api'
import { formatDelta, formatMoney, formatMoneyFlat, formatShare } from '@/lib/format'
import {
  NetworkFilter, TokenTable, usePortfolio, portfolioOf, portfolioFailureText, unreadArms,
  type PortfolioState,
} from '@/components/portfolio'
import { selectPortfolio } from '@/components/portfolio/select-portfolio'

/**
 * Portfolio, per P2 in the design: aggregate on top, per-wallet below.
 *
 * Client-side because the arm list is — it lives behind a Privy session held in
 * the browser, so a server render has nothing to read. The page above keeps the
 * metadata export and the Suspense boundary the query string needs.
 *
 * Split for the same reason the other wallet surfaces are: Privy's hooks throw
 * outside their provider, and the provider does not mount without a valid app
 * id. The frame renders either way.
 */
export function PortfolioView() {
  return usePrivyAvailable() ? <ConnectedPortfolio /> : <Frame wallets={[]} />
}

function ConnectedPortfolio() {
  // One `useWallets` for the whole page — two would mean two components
  // reconciling the same account against the same token.
  const { state, linkWallet, linking, linkError, addWatchOnly } = useWallets()
  const [linkOpen, setLinkOpen] = useState(false)
  const tab = useSearchParams().get('tab') ?? 'tokens'

  const wallets = armsOf(state)
  const portfolio = usePortfolio(wallets, state.status !== 'loading')

  return (
    <Frame
      wallets={wallets}
      portfolioState={portfolio.state}
      onRefresh={portfolio.refresh}
      loading={state.status === 'loading'}
      failure={state.status === 'failed' ? state.reason : undefined}
      linkError={linkError}
      tab={tab}
      onLink={() => setLinkOpen(true)}
      dialog={
        <LinkWalletDialog
          open={linkOpen}
          onClose={() => setLinkOpen(false)}
          onConnect={linkWallet}
          onPaste={addWatchOnly}
          linking={linking}
          linkError={linkError}
          used={wallets.length}
          max={MAX_ARMS}
        />
      }
    />
  )
}

interface FrameProps {
  wallets: Arm[]
  portfolioState?: PortfolioState
  onRefresh?: () => void
  loading?: boolean
  /** Set when the last refresh failed. The arms above are still what we know. */
  failure?: WalletsFailure | undefined
  linkError?: string | null
  tab?: string
  onLink?: (() => void) | undefined
  dialog?: React.ReactNode
}

export function Frame({
  wallets,
  portfolioState,
  onRefresh,
  loading = false,
  failure,
  linkError,
  tab = 'tokens',
  onLink,
  dialog,
}: FrameProps) {
  const [network, setNetwork] = useState<string | null>(null)
  const portfolio = portfolioState ? portfolioOf(portfolioState) : null
  const selectedNetwork = portfolio?.chains.some((chain) => chain.chainId === network) ? network : null
  const selected = useMemo(() => portfolio ? selectPortfolio(portfolio, selectedNetwork) : null, [portfolio, selectedNetwork])
  const missing = unreadArms(portfolio)
  const hasReading = !!portfolio?.arms.some((arm) => arm.status === 'ok')
  const money = selected && hasReading ? formatMoney(selected.total, selected.currency) : null
  const delta = selected && hasReading
    ? formatDelta(selected.change1d, selected.gross, selected.currency)
    : null
  const balanceFailure = portfolioState?.status === 'failed' ? portfolioFailureText(portfolioState.reason) : null
  const balancesLoading = wallets.length > 0 && (!portfolioState || portfolioState.status === 'loading')
  const linked = wallets.length > 0
  const free = MAX_ARMS - wallets.length

  return (
    <div data-portfolio className="relative flex min-h-0 flex-1 flex-col [&>*]:shrink-0">
      <PageHeader
        title="Portfolio"
        eyebrow={
          linked
            ? `Total balance · ${wallets.length} wallet${wallets.length > 1 ? 's' : ''}`
            : 'Total balance'
        }
        headline={money ? <Figure {...money} /> : loading || linked || failure
          ? <Figure whole="—" /> : <Figure whole="$0" fraction="00" />}
        detail={loading ? 'Loading wallets…' : failure && !linked ? 'Wallets unavailable' : !linked ? 'No wallets linked yet.' : balancesLoading ? 'Reading balances…' : !hasReading ? 'Balances unavailable' : (
          <span>
            {delta?.text ?? 'No change today'}
            {selectedNetwork ? ` · ${portfolio?.chains.find((chain) => chain.chainId === selectedNetwork)?.name}` : ''}
            {missing.length > 0 ? ' · Partial total' : ''}
            {portfolioState?.status === 'failed' ? ' · Last successful reading' : ''}
          </span>
        )}
        action={
          <Button variant="secondary" size="sm" onClick={onLink} disabled={!onLink}>
            Link wallet
          </Button>
        }
      />

      {/* Reported above whatever we already know, never in place of it: a
          refresh that could not reach the service has said nothing about which
          wallets exist, and "No wallets yet" over a real account reads as data
          loss. */}
      {failure ? (
        <div className="px-5 pt-4 sm:px-[26px]">
          <Callout severity="caution" title={failureText(failure).title}>
            {failureText(failure).body}
          </Callout>
        </div>
      ) : null}

      {linked && (balanceFailure || missing.length > 0) ? (
        <div className="px-5 pt-4 sm:px-[26px]" role="status">
          <Callout severity="caution" title={balanceFailure?.title ?? 'Some balances are missing'}>
            {balanceFailure?.body ?? `${missing.length} of ${wallets.length} wallets could not be read. Their balances are excluded from the total.`}
            {portfolio && balanceFailure ? ' Showing the last successful reading.' : ''}
            <Button variant="secondary" size="sm" onClick={onRefresh}>Refresh balances</Button>
          </Callout>
        </div>
      ) : null}

      {linkError ? (
        <div className="px-5 pt-4 sm:px-[26px]">
          <Callout severity="caution" title="That wallet wasn’t linked">
            {linkError}
          </Callout>
        </div>
      ) : null}

      {linked ? (
        <>
          <TabBar
            label="Portfolio views"
            tabs={[
              { value: 'tokens', label: 'Tokens' },
              { value: 'wallets', label: 'Wallets' },
              { value: 'approvals', label: 'Approvals', disabled: true },
            ]}
            aside={<NetworkFilter chains={portfolio?.chains ?? []} value={selectedNetwork} onChange={setNetwork} />}
          />

          {tab === 'wallets' ? (
            <div className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto overscroll-contain px-5 py-4.5 sm:px-[26px]">
              {wallets.map((arm) => {
                const summary = selected?.arms.find((item) => item.walletId === arm.id)
                const known = summary?.status === 'ok'
                return (
                  <ArmCard
                    key={arm.id}
                    arm={arm}
                    value={known ? formatMoneyFlat(summary.total, selected?.currency) : null}
                    share={known ? `${formatShare(summary.share)} of holdings`
                      : balancesLoading ? 'Reading balance…' : 'Balance unavailable'}
                  />
                )
              })}
              {free > 0 ? (
                <div className="flex flex-wrap items-center justify-between gap-3.5 rounded-[12px] border border-dashed border-[var(--ot-border-strong)] px-4 py-3.5">
                  <span className="text-[13px] leading-[1.45] text-[var(--ot-text-2)]">
                    {free} slot{free > 1 ? 's' : ''} free. Otto can route across every wallet you
                    link.
                  </span>
                  <Button variant="secondary" size="sm" onClick={onLink} disabled={!onLink}>
                    Link wallet
                  </Button>
                </div>
              ) : null}
            </div>
          ) : (
            /* The same water as the empty scene, for the same reason: this is
               the page's canvas. The rows float on it as their own cards, so the
               ambient layer stays in the margins and the gaps between them —
               never under a number someone is about to act on. */
            <div className="ot-token-sea relative flex min-h-0 flex-1 flex-col overflow-hidden">
              <div className="ot-caustic" />
              <div className="ot-caustic ot-caustic--b" />
              <BubbleField pattern="canvas" />
              <SeaLife />
              <div className="relative flex min-h-0 flex-1 flex-col">
                {balancesLoading ? <SkeletonShelf rows={3} avatar={36} className="m-4 sm:m-[22px]" /> : hasReading && selected ? (
                  <TokenTable rows={selected.assets} chains={selected.chains} currency={selected.currency} />
                ) : <p className="px-5 py-5 text-[var(--ot-text-2)]">Balances could not be read. Refresh to try again.</p>}
              </div>
            </div>
          )}
        </>
      ) : loading ? (
        <SkeletonShelf rows={2} />
      ) : failure ? (
        // Nothing known and the refresh failed. The banner above has said why;
        // inviting someone to link a wallet on top of it would be noise.
        <div className="flex-1" />
      ) : (
        <div className="ot-canvas relative flex flex-1 items-center justify-center overflow-hidden px-5 py-7">
          <BubbleField pattern="calm" />
          <EmptyState
            className="relative"
            title="No wallets yet"
            description="Link a wallet and I’ll start keeping an eye on it. Up to eight."
            illustration={<Otto pose="base" size={120} animated />}
            action={
              <Button variant="primary" size="sm" onClick={onLink} disabled={!onLink}>
                Link wallet
              </Button>
            }
          />
        </div>
      )}

      {dialog}
      <FirstIntentNudge className="absolute right-3 bottom-3 left-3 z-20 max-h-[45dvh] overflow-y-auto rounded-2xl bg-[var(--ot-card)] shadow-lg sm:left-auto" />
    </div>
  )
}
