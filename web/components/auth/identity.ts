import type { Identity } from '@/components/shell/account-menu'
import { truncateAddress } from '@/lib/format'

/**
 * The slice of a Privy user this reads. Structural rather than Privy's own
 * type so the function stays pure — and testable without mounting a provider.
 */
export interface PrivyIdentity {
  id: string
  email?: { address: string } | null
  google?: { email: string } | null
  wallet?: { address: string } | null
}

/** What the service stored, once it has: the attested name and email. */
export interface StoredIdentity {
  name: string | null
  email: string | null
}

/**
 * How a person is named, in the order they would recognise themselves: the
 * name we stored, the email they typed, the Google account they picked, then
 * the wallet they connected. A DID is last because nobody knows their own DID.
 *
 * The stored values win over Privy's client object because they are attested
 * — signed by Privy into the identity token and written by the service — and
 * because they are what every other surface shows. Privy's object is the
 * fallback for the moment before the session is established.
 */
export function identityFrom(
  stored: StoredIdentity | null,
  user: PrivyIdentity | null,
): Identity | undefined {
  const name = stored?.name ?? null
  const email = stored?.email ?? user?.email?.address ?? user?.google?.email ?? null

  if (name) return email && email !== name ? { label: name, detail: email } : { label: name }
  if (email) return { label: email }
  if (user?.wallet?.address) return { label: truncateAddress(user.wallet.address), mono: true }
  if (user?.id) return { label: user.id, mono: true }
  return undefined
}
