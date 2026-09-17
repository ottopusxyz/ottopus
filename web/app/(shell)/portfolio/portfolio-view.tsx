'use client'

import { useSearchParams } from 'next/navigation'
import { useState } from 'react'
import { usePrivyAvailable } from '@/components/auth'
import { Otto } from '@/components/brand'
import { BubbleField } from '@/components/motion'
import { SkeletonShelf } from '@/components/motion/loaders'
import { Figure, FirstIntentNudge, PageHeader, TabBar } from '@/components/shell'
import { Button, Callout, Chip, EmptyState } from '@/components/ui'
import {
  ArmCard,
  LinkWalletDialog,
  MAX_ARMS,
  TokenTable,
  armsOf,
  failureText,
  useWallets,
  type WalletsFailure,
} from '@/components/wallets'
import type { Arm } from '@/lib/api'

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

  return (
    <Frame
      wallets={wallets}
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
  loading?: boolean
  /** Set when the last refresh failed. The arms above are still what we know. */
  failure?: WalletsFailure | undefined
  linkError?: string | null
  tab?: string
  onLink?: (() => void) | undefined
  dialog?: React.ReactNode
}

function Frame({
  wallets,
  loading = false,
  failure,
  linkError,
  tab = 'tokens',
  onLink,
  dialog,
}: FrameProps) {
  const linked = wallets.length > 0
  const free = MAX_ARMS - wallets.length

  return (
    <>
      <PageHeader
        title="Portfolio"
        eyebrow={
          linked
            ? `Total balance · ${wallets.length} wallet${wallets.length > 1 ? 's' : ''}`
            : 'Total balance'
        }
        headline={<Figure whole="$0" fraction="00" />}
        detail={linked ? 'Balances aren’t connected yet.' : 'No wallets linked yet.'}
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
            aside={<Chip>All networks</Chip>}
          />

          {tab === 'wallets' ? (
            <div className="flex flex-1 flex-col gap-2.5 px-5 py-4.5 sm:px-[26px]">
              {wallets.map((arm) => (
                <ArmCard key={arm.id} arm={arm} />
              ))}
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
            <div className="flex flex-1 flex-col">
              <TokenTable />
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
      <FirstIntentNudge />
    </>
  )
}
