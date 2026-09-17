'use client'

import { useState } from 'react'
import { usePrivyAvailable } from '@/components/auth'
import { Otto } from '@/components/brand'
import { SkeletonShelf } from '@/components/motion/loaders'
import { Button, Callout, EmptyState } from '@/components/ui'
import { MAX_ARMS } from './naming'
import { useWallets } from './use-wallets'
import { LinkWalletDialog } from './link-wallet-dialog'
import { WalletList } from './wallet-list'

/**
 * Linked wallets, end to end: the list, the dialog, and the failure modes
 * worth naming.
 *
 * Used on Settings, and by the Portfolio empty state. Both need the same
 * behaviour, and a second copy of the sync effect would mean two components
 * racing to reconcile the same account.
 *
 * Split in two because Privy's hooks throw outside their provider, and the
 * provider does not mount without a valid app id. The rest of the app stays
 * up in that case on purpose — a typo in one environment variable should not
 * blank the settings page — so this has to check before it calls a hook, and a
 * hook cannot be called conditionally. Same shape as RequireSession.
 */
export function WalletsPanel() {
  return usePrivyAvailable() ? (
    <ConnectedPanel />
  ) : (
    <Callout severity="caution" title="Sign-in isn’t configured">
      Wallets need Privy, and this deployment has no valid app id. Nothing is wrong with your
      account.
    </Callout>
  )
}

function ConnectedPanel() {
  const { state, linkWallet, linking, linkError, addWatchOnly, unlink } = useWallets()
  const [open, setOpen] = useState(false)

  if (state.status === 'loading') {
    return <SkeletonShelf rows={2} />
  }

  if (state.status === 'failed') {
    return (
      <Callout
        severity="caution"
        title={
          state.reason === 'no-identity-token'
            ? 'Wallets can’t sync yet'
            : 'Can’t reach Ottopus right now'
        }
      >
        {state.reason === 'no-identity-token'
          ? 'Identity tokens are switched off for this app, so Ottopus can’t confirm which wallets are yours. Enable them in the Privy dashboard under User management → Authentication → Advanced.'
          : 'Your wallets are safe — this is our side. Try again in a moment.'}
      </Callout>
    )
  }

  const { wallets, overflow } = state

  return (
    <>
      {overflow.length > 0 ? (
        <Callout severity="caution" title={`${overflow.length} wallet${overflow.length > 1 ? 's' : ''} didn’t fit`}>
          Otto has {MAX_ARMS} arms and they’re all in use, so the most recently linked wallets
          aren’t here. Unlink one to make room.
        </Callout>
      ) : null}

      {wallets.length === 0 ? (
        <EmptyState
          title="No wallets yet"
          description="Link a wallet and I’ll start keeping an eye on it. Up to eight."
          illustration={<Otto pose="base" size={120} animated />}
          action={
            <Button variant="primary" size="sm" onClick={() => setOpen(true)}>
              Link wallet
            </Button>
          }
        />
      ) : (
        <>
          <WalletList wallets={wallets} onUnlink={unlink} />
          <div className="px-5 py-4 sm:px-[26px]">
            <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
              Link another
            </Button>
          </div>
        </>
      )}

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
    </>
  )
}
