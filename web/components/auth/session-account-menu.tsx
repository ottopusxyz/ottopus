'use client'

import { usePrivy } from '@privy-io/react-auth'
import { AccountMenu, type Identity } from '@/components/shell/account-menu'
import { identityFrom } from './identity'
import { usePrivyAvailable } from './privy-provider'
import { useSession } from './session-provider'

/**
 * What to call the signed-in person, or undefined if there is nobody yet.
 *
 * Shared by the sidebar menu and Settings' account card, so the two surfaces
 * cannot name the same person differently. Only callable inside the Privy
 * provider — both callers are already behind a usePrivyAvailable() check.
 */
export function useIdentity(): Identity | undefined {
  const { ready, authenticated, user } = usePrivy()
  const session = useSession()

  if (!ready || !authenticated) return undefined
  return identityFrom(session.status === 'ready' ? session.user : null, user)
}

/**
 * Fills the shell's account slot. Separate from AccountMenu so the shell itself
 * stays free of Privy — the slot is the seam, and this is what plugs into it.
 */
export function SessionAccountMenu() {
  return usePrivyAvailable() ? <LiveAccountMenu /> : <AccountMenu />
}

function LiveAccountMenu() {
  const { logout } = usePrivy()
  const identity = useIdentity()

  // No sign-out row without someone to sign out: the menu still opens for the
  // theme and the links, which do not need a session.
  return <AccountMenu identity={identity} onSignOut={identity ? () => void logout() : undefined} />
}
