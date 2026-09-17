'use client'

import { useState } from 'react'
import { usePrivyAvailable } from '@/components/auth'
import { Button, type ButtonProps } from '@/components/ui'
import { LinkWalletDialog } from './link-wallet-dialog'
import { MAX_ARMS } from './naming'
import { useWallets } from './use-wallets'

export interface LinkWalletButtonProps extends Pick<ButtonProps, 'variant' | 'size' | 'fullWidth'> {
  children?: string
}

/**
 * The link flow, on its own, for pages that are not about wallets.
 *
 * One per page. It calls `useWallets`, and a second instance would mean two
 * components reconciling the same account against the same identity token —
 * harmless, since sync is idempotent, but wasteful and confusing to debug.
 * Anywhere that wants the list as well should use `WalletsPanel` instead.
 *
 * Renders a disabled button when Privy is unconfigured rather than nothing:
 * an action that vanishes reads as a missing feature, one that will not press
 * reads as a deployment problem, and the second is the truth.
 */
export function LinkWalletButton(props: LinkWalletButtonProps) {
  const available = usePrivyAvailable()
  const { variant = 'primary', size = 'sm', fullWidth, children = 'Link wallet' } = props

  if (!available) {
    return (
      <Button variant={variant} size={size} fullWidth={fullWidth ?? false} disabled>
        {children}
      </Button>
    )
  }
  return <ConnectedButton {...props} />
}

function ConnectedButton({
  variant = 'primary',
  size = 'sm',
  fullWidth,
  children = 'Link wallet',
}: LinkWalletButtonProps) {
  const { state, linkWallet, linking, linkError, addWatchOnly } = useWallets()
  const [open, setOpen] = useState(false)
  const used = state.status === 'ready' ? state.wallets.length : 0

  return (
    <>
      <Button
        variant={variant}
        size={size}
        fullWidth={fullWidth ?? false}
        onClick={() => setOpen(true)}
        disabled={state.status === 'loading'}
      >
        {children}
      </Button>
      <LinkWalletDialog
        open={open}
        onClose={() => setOpen(false)}
        onConnect={linkWallet}
        onPaste={addWatchOnly}
        linking={linking}
        linkError={linkError}
        used={used}
        max={MAX_ARMS}
      />
    </>
  )
}
