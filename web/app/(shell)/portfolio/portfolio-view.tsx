'use client'

import { useSearchParams } from 'next/navigation'
import { useState } from 'react'
import { usePrivyAvailable } from '@/components/auth'
import { Otto } from '@/components/brand'
import { BubbleField } from '@/components/motion'
import { SkeletonShelf } from '@/components/motion/loaders'
import { Figure, FirstIntentNudge, PageHeader, TabBar } from '@/components/shell'
import { Button, Chip, EmptyState } from '@/components/ui'
import {
  ArmCard,
  LinkWalletDialog,
  MAX_ARMS,
  TokenTable,
  useWallets,
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

  const wallets = state.status === 'ready' ? state.wallets : []

  return (
    <Frame
      wallets={wallets}
      loading={state.status === 'loading'}
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
  tab?: string
  onLink?: (() => void) | undefined
  dialog?: React.ReactNode
}

function Frame({ wallets, loading = false, tab = 'tokens', onLink, dialog }: FrameProps) {
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
