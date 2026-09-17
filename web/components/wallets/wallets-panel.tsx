'use client'

import { useState, type ReactNode } from 'react'
import { usePrivyAvailable } from '@/components/auth'
import { Otto } from '@/components/brand'
import { SkeletonShelf } from '@/components/motion/loaders'
import { Button, Callout, EmptyState } from '@/components/ui'
import { LinkWalletDialog } from './link-wallet-dialog'
import { MAX_ARMS } from './naming'
import { armsOf, useWallets, type WalletsFailure } from './use-wallets'
import { WalletList } from './wallet-list'

/**
 * Why a refresh failed, in words. Shared by both wallet surfaces so they
 * cannot drift into describing the same failure differently.
 */
export function failureText(reason: WalletsFailure): { title: string; body: string } {
  if (reason === 'no-identity-token') {
    return {
      title: 'Wallets can’t sync yet',
      body: 'Identity tokens are switched off for this app, so Ottopus can’t confirm which wallets are yours. Enable them in the Privy dashboard under User management → Authentication → Advanced.',
    }
  }
  return {
    title: 'Can’t reach Ottopus right now',
    body: 'Your wallets are safe — this is our side, and nothing has changed. Try again in a moment.',
  }
}

/**
 * Settings' wallet card, per P6.
 *
 * Portfolio drives the same pieces from its own `useWallets` rather than
 * mounting this — one hook per page, or two components reconcile the same
 * account against the same token.
 *
 * Split in two because Privy's hooks throw outside their provider, and the
 * provider does not mount without a valid app id. The rest of the app stays up
 * in that case on purpose — a typo in one environment variable should not blank
 * the settings page — so this has to check before it calls a hook, and a hook
 * cannot be called conditionally. Same shape as RequireSession.
 */
export function WalletsPanel() {
  return usePrivyAvailable() ? (
    <ConnectedPanel />
  ) : (
    <Card>
      <div className="px-[22px] py-4">
        <Callout severity="caution" title="Sign-in isn’t configured">
          Wallets need Privy, and this deployment has no valid app id. Nothing is wrong with your
          account.
        </Callout>
      </div>
    </Card>
  )
}

/** The P6 frame: one bordered card with a header that counts. */
function Card({
  children,
  count,
  action,
}: {
  children: ReactNode
  count?: number | undefined
  action?: ReactNode
}) {
  return (
    <section className="overflow-hidden rounded-[18px] border border-[var(--ot-border)] bg-[var(--ot-card)]">
      <div className="flex items-center justify-between gap-4 border-b border-[var(--ot-border)] px-[22px] py-4">
        <h2 className="text-[15px] font-semibold">
          Linked wallets{' '}
          {count !== undefined ? (
            <span className="font-normal text-[var(--ot-text-3)]">
              {count} of {MAX_ARMS}
            </span>
          ) : null}
        </h2>
        {action}
      </div>
      {children}
    </section>
  )
}

function ConnectedPanel() {
  const { state, linkWallet, linking, linkError, addWatchOnly, unlink } = useWallets()
  const [open, setOpen] = useState(false)

  const wallets = armsOf(state)
  const full = wallets.length >= MAX_ARMS

  return (
    <Card
      count={state.status === 'loading' ? undefined : wallets.length}
      action={
        <Button
          variant="secondary"
          size="sm"
          onClick={() => setOpen(true)}
          disabled={state.status === 'loading' || full}
        >
          Link wallet
        </Button>
      }
    >
      {/* A failed refresh is reported above the list, never instead of it —
          it says nothing new about which wallets exist. */}
      {state.status === 'failed' ? (
        <div className="px-[22px] pt-4">
          <Callout severity="caution" title={failureText(state.reason).title}>
            {failureText(state.reason).body}
          </Callout>
        </div>
      ) : null}

      {linkError ? (
        <div className="px-[22px] pt-4">
          <Callout severity="caution" title="That wallet wasn’t linked">
            {linkError}
          </Callout>
        </div>
      ) : null}

      {state.status === 'loading' ? (
        <SkeletonShelf rows={2} />
      ) : wallets.length === 0 ? (
        <div className="px-[22px] py-7">
          <EmptyState
            title="No wallets yet"
            description="Link a wallet and I’ll start keeping an eye on it. Up to eight."
            illustration={<Otto pose="base" size={96} animated />}
            action={
              <Button variant="primary" size="sm" onClick={() => setOpen(true)}>
                Link wallet
              </Button>
            }
          />
        </div>
      ) : (
        <WalletList wallets={wallets} onUnlink={unlink} />
      )}

      {state.status !== 'loading' && state.overflow.length > 0 ? (
        <p className="border-t border-[var(--ot-border)] bg-[var(--ot-warn-bg)] px-[22px] py-3.5 text-[12.5px] leading-[1.5] text-[var(--ot-warn-text)]">
          {state.overflow.length} wallet{state.overflow.length > 1 ? 's' : ''} didn’t fit — all
          {' '}
          {MAX_ARMS} arms are in use. Unlink one to make room.
        </p>
      ) : null}

      <p className="border-t border-[var(--ot-border)] bg-[var(--ot-surface-2)] px-[22px] py-3.5 text-[12.5px] leading-[1.5] text-[var(--ot-text-2)]">
        Unlinking never moves funds — it only stops Otto from planning with that wallet.
      </p>

      <LinkWalletDialog
        open={open}
        onClose={() => setOpen(false)}
        onConnect={linkWallet}
        onPaste={addWatchOnly}
        linking={linking}
        linkError={linkError}
        used={wallets.length}
        max={MAX_ARMS}
      />
    </Card>
  )
}
