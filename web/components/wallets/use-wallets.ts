'use client'

import { useIdentityToken, useLinkAccount, usePrivy, useUnlinkWallet } from '@privy-io/react-auth'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ApiError,
  addWatchOnlyWallet,
  syncWallets,
  unlinkWallet as unlinkOnServer,
  updateWallet as updateOnServer,
  type Arm,
  type Credentials,
} from '@/lib/api'

/**
 * The arms, and the two ways one arrives.
 *
 * **Proved** wallets come through Privy's link flow. Privy issues the EIP-4361
 * nonce, the wallet signs it against our own origin, and Privy verifies the
 * signature. We never see the signature — we see Privy's attestation of it, in
 * an identity token the service verifies against Privy's public key. No private
 * key touches this app either way, which is the invariant that matters.
 *
 * **Watch-only** wallets are pasted addresses, and nobody proved them. That is
 * the point: it is the only way a Safe gets in, since a contract account cannot
 * `personal_sign` at all. They can never sign.
 *
 * The syncing is deliberately driven by the identity token rather than by the
 * link callback. Privy re-issues the token when the linked accounts change, so
 * waiting for the new token is what guarantees we sync the wallet that was just
 * linked rather than the list from before it.
 */

export type WalletsFailure = 'unreachable' | 'unconfigured' | 'no-identity-token'

/**
 * `failed` carries the arms too, and that is the point of the shape.
 *
 * A refresh that could not reach the service has not told us anything new
 * about which wallets exist — it has told us nothing. Dropping the list on the
 * way through would render "no wallets yet" over a perfectly good account,
 * which reads as data loss rather than as a network blip.
 */
export type WalletsState =
  | { status: 'loading' }
  | { status: 'ready'; wallets: Arm[]; overflow: string[] }
  | { status: 'failed'; reason: WalletsFailure; wallets: Arm[]; overflow: string[] }

/** What we currently know, whether or not the last refresh succeeded. */
export function armsOf(state: WalletsState): Arm[] {
  return state.status === 'loading' ? [] : state.wallets
}

export interface UseWallets {
  state: WalletsState
  /** Opens Privy's modal. Discovery is EIP-6963, plus WalletConnect for mobile. */
  linkWallet: () => void
  /** True from the moment the modal opens until the new arm has synced. */
  linking: boolean
  linkError: string | null
  addWatchOnly: (input: { address: string; label?: string }) => Promise<void>
  unlink: (arm: Arm) => Promise<void>
  /** Rename an arm or change its kind. The list re-reads afterwards. */
  update: (arm: Arm, edit: { label: string | null; walletType: string }) => Promise<void>
  refresh: () => void
}

export function useWallets(): UseWallets {
  const { ready, authenticated, getAccessToken } = usePrivy()
  const { identityToken } = useIdentityToken()
  const { unlink: unlinkAtPrivy } = useUnlinkWallet()

  const [state, setState] = useState<WalletsState>({ status: 'loading' })
  const [linking, setLinking] = useState(false)
  const [linkError, setLinkError] = useState<string | null>(null)
  // Bumped to force a sync when nothing about the token changed — after a
  // watch-only add, or when a link callback fires before the new token lands.
  const [nonce, setNonce] = useState(0)

  const { linkWallet } = useLinkAccount({
    onSuccess: () => {
      setLinkError(null)
      // Not a sync call. The identity token that proves this wallet may not
      // have arrived yet; bumping the nonce re-runs the effect below, and the
      // token landing re-runs it again. Sync is idempotent, so both is fine.
      setNonce((n) => n + 1)
    },
    onError: (error) => {
      setLinking(false)
      // Closing the modal reports as an error. It is not one, and saying
      // "something went wrong" to someone who simply changed their mind is
      // worse than saying nothing.
      setLinkError(error === 'exited_auth_flow' ? null : 'That wallet could not be linked.')
    },
  })

  const credentials = useCallback(async (): Promise<Credentials | null> => {
    const accessToken = await getAccessToken()
    return accessToken ? { accessToken, identityToken } : null
  }, [getAccessToken, identityToken])

  /** So an in-flight sync from a stale token cannot overwrite a newer result. */
  const generation = useRef(0)

  useEffect(() => {
    if (!ready || !authenticated) return

    const mine = ++generation.current
    let cancelled = false

    void (async () => {
      try {
        const creds = await credentials()
        if (!creds || cancelled) return

        const { wallets, overflow } = await syncWallets(creds)
        if (cancelled || mine !== generation.current) return
        setState({ status: 'ready', wallets, overflow })
        setLinking(false)
      } catch (error) {
        if (cancelled || mine !== generation.current) return
        const { status, code } = error as ApiError
        const reason: WalletsFailure =
          code === 'identity_token_required'
            ? 'no-identity-token'
            : status === 503
              ? 'unconfigured'
              : 'unreachable'
        // Functional update so the arms from the last good sync survive. The
        // effect closes over nothing about them, and reading state here would
        // capture whatever was current when this run started.
        setState((previous) =>
          previous.status === 'loading'
            ? { status: 'failed', reason, wallets: [], overflow: [] }
            : { status: 'failed', reason, wallets: previous.wallets, overflow: previous.overflow },
        )
        setLinking(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [ready, authenticated, identityToken, nonce, credentials])

  const addWatchOnly = useCallback(
    async ({ address, label }: { address: string; label?: string }) => {
      const creds = await credentials()
      if (!creds) throw new Error('Not signed in')
      // A Safe is watch-only too, but naming it lets the arm show as a Safe
      // rather than as an anonymous pasted address.
      await addWatchOnlyWallet(creds, { address, label })
      setNonce((n) => n + 1)
    },
    [credentials],
  )

  const unlink = useCallback(
    async (arm: Arm) => {
      const creds = await credentials()
      if (!creds) throw new Error('Not signed in')

      // Privy first, and only then us. The reverse order leaves a window where
      // our row is gone but Privy still attests the wallet, and the next sync
      // would link it straight back — an unlink that silently undoes itself.
      //
      // Failing between the two is safe in this order: Privy no longer attests
      // the wallet, so the next sync unlinks our row on its own. The reverse
      // order has no such recovery.
      if (!arm.isWatchOnly) await unlinkAtPrivy({ address: arm.address })
      await unlinkOnServer(creds, arm.id)
      setNonce((n) => n + 1)
    },
    [credentials, unlinkAtPrivy],
  )

  const update = useCallback(
    async (arm: Arm, edit: { label: string | null; walletType: string }) => {
      const creds = await credentials()
      if (!creds) throw new Error('Not signed in')
      await updateOnServer(creds, arm.id, edit)
      setNonce((n) => n + 1)
    },
    [credentials],
  )

  return {
    state,
    update,
    linkWallet: () => {
      setLinkError(null)
      setLinking(true)
      linkWallet()
    },
    linking,
    linkError,
    addWatchOnly,
    unlink,
    refresh: () => setNonce((n) => n + 1),
  }
}
