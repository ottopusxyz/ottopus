'use client'

import { usePrivy } from '@privy-io/react-auth'
import { AccountRow } from '@/components/shell/account-row'
import { Button } from '@/components/ui'
import { truncateAddress } from '@/lib/format'
import { usePrivyAvailable } from './privy-provider'
import { useSession } from './session-provider'

/**
 * How a person is named in the sidebar, in the order they would recognise
 * themselves: the email they typed, the Google account they picked, then the
 * wallet they connected. A DID is last because nobody knows their own DID.
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
 * Fills the shell's account slot. Separate from AccountRow so the shell itself
 * stays free of Privy — the slot is the seam, and this is what plugs into it.
 */
export function SessionAccountRow() {
  return usePrivyAvailable() ? <LiveAccountRow /> : <AccountRow />
}

function LiveAccountRow() {
  const { ready, authenticated, user, logout } = usePrivy()
  const session = useSession()

  if (!ready || !authenticated) return <AccountRow />

  // Prefer what the service stored: it is the attested name, and it is the one
  // every other surface will show. Privy's client object is the fallback for
  // the moment before the session is established.
  const identity =
    session.status === 'ready'
      ? (session.user.name ?? session.user.email ?? identityOf(user))
      : identityOf(user)

  return (
    <div className="flex flex-col gap-2">
      <AccountRow identity={identity} />
      <Button variant="ghost" size="sm" onClick={() => logout()} className="justify-start">
        Sign out
      </Button>
    </div>
  )
}
