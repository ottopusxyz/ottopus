'use client'

import { usePrivy } from '@privy-io/react-auth'
import { AccountRow } from '@/components/shell/account-row'
import { Button } from '@/components/ui'
import { truncateAddress } from '@/lib/format'
import { usePrivyAvailable } from './privy-provider'
import { useSession } from './session-provider'

/**
 * How a person is named, in the order they would recognise themselves: the
 * email they typed, the Google account they picked, then the wallet they
 * connected. A DID is last because nobody knows their own DID.
 */
function identityOf(user: ReturnType<typeof usePrivy>['user']): string | undefined {
  if (!user) return undefined
  return (
    user.email?.address ??
    user.google?.email ??
    (user.wallet?.address ? truncateAddress(user.wallet.address) : undefined) ??
    user.id
  )
}

/**
 * What to call the signed-in person, or undefined if there is nobody yet.
 *
 * Shared by the sidebar row and Settings' account card, so the two surfaces
 * cannot name the same person differently. Only callable inside the Privy
 * provider — both callers are already behind a usePrivyAvailable() check.
 */
export function useIdentity(): string | undefined {
  const { ready, authenticated, user } = usePrivy()
  const session = useSession()

  if (!ready || !authenticated) return undefined

  // Prefer what the service stored: it is the attested name, and it is the one
  // every other surface will show. Privy's client object is the fallback for
  // the moment before the session is established.
  return session.status === 'ready'
    ? (session.user.name ?? session.user.email ?? identityOf(user))
    : identityOf(user)
}

/**
 * Fills the shell's account slot. Separate from AccountRow so the shell itself
 * stays free of Privy — the slot is the seam, and this is what plugs into it.
 */
export function SessionAccountRow() {
  return usePrivyAvailable() ? <LiveAccountRow /> : <AccountRow />
}

function LiveAccountRow() {
  const { logout } = usePrivy()
  const identity = useIdentity()

  if (!identity) return <AccountRow />

  return (
    <div className="flex flex-col gap-2">
      <AccountRow identity={identity} />
      <Button variant="ghost" size="sm" onClick={() => logout()} className="justify-start">
        Sign out
      </Button>
    </div>
  )
}
