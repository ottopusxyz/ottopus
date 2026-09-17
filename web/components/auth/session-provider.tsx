'use client'

import { useIdentityToken, usePrivy } from '@privy-io/react-auth'
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { establishSession, type SessionUser } from '@/lib/api'

export type SessionState =
  | { status: 'signed-out' }
  | { status: 'establishing' }
  | { status: 'ready'; user: SessionUser }
  /** Signed in with Privy, but the service could not be reached or agreed. */
  | { status: 'failed'; reason: 'unreachable' | 'unconfigured' | 'rejected' }

const SessionContext = createContext<SessionState>({ status: 'signed-out' })

/**
 * Said once, not once per render. Without the dashboard toggle the name column
 * stays null forever and nothing in the app looks broken — which is exactly the
 * kind of silence that costs an afternoon.
 */
let warnedAboutIdentity = false

/** The Ottopus user behind the Privy session, once the service has confirmed one. */
export function useSession(): SessionState {
  return useContext(SessionContext)
}

/**
 * Turns a Privy session into an Ottopus user.
 *
 * This is the step that creates the database row. Privy signing someone in
 * happens entirely in the browser — nothing reaches Postgres until something
 * calls the service, and this is that call. Without it, a person can sign in,
 * see the app, and have no row to hang a wallet or a plan off.
 *
 * It runs once per cold boot rather than once per sign-in, because a returning
 * visitor with a live token never signs in again and would otherwise never be
 * created. The call is an idempotent upsert, so repeating it costs one query.
 *
 * A failure here does not sign anyone out. The session is real; it is our
 * service that is unavailable, and the shell says so rather than bouncing
 * someone back to a login form that would work fine.
 */
export function SessionProvider({ children }: { children: ReactNode }) {
  const { ready, authenticated, getAccessToken } = usePrivy()
  const { identityToken } = useIdentityToken()
  // Only the result of the exchange is state. Being signed out is not a thing
  // that happens to this component — it is what Privy already says.
  const [established, setEstablished] = useState<SessionState | null>(null)

  /**
   * What we last sent, so the double-effect in development does not send it
   * twice.
   *
   * Keyed on both tokens, not just the access token. Privy resolves them
   * separately and the identity token usually lands a tick later — keying on
   * the access token alone meant the first call went out without a name, and
   * the re-run that finally had one was skipped as a duplicate. The row existed
   * with a null name and nothing ever filled it.
   */
  const sent = useRef<string | null>(null)

  useEffect(() => {
    if (!ready) return
    if (!authenticated) {
      sent.current = null
      return
    }

    let cancelled = false

    void (async () => {
      const accessToken = await getAccessToken()
      if (!accessToken || cancelled) return

      if (!identityToken && !warnedAboutIdentity) {
        warnedAboutIdentity = true
        console.warn(
          '[ottopus] No Privy identity token, so no name or email will be stored. ' +
            'Enable "Return user data in an identity token" in the Privy dashboard ' +
            'under User management > Authentication > Advanced.',
        )
      }

      const key = `${accessToken}|${identityToken ?? ''}`
      if (sent.current === key) return
      const enriching = sent.current !== null
      sent.current = key

      // The second call only adds a name to a row that already exists, so it
      // must not throw the app back to a loading state.
      if (!enriching) setEstablished({ status: 'establishing' })
      try {
        const { user } = await establishSession({ accessToken, identityToken })
        if (!cancelled) setEstablished({ status: 'ready', user })
      } catch (error) {
        if (cancelled) return
        const status = (error as { status?: number }).status
        setEstablished({
          status: 'failed',
          reason: status === 503 ? 'unconfigured' : status === 401 ? 'rejected' : 'unreachable',
        })
      }
    })()

    return () => {
      cancelled = true
    }
  }, [ready, authenticated, getAccessToken, identityToken])

  const state: SessionState =
    !ready || !authenticated ? { status: 'signed-out' } : (established ?? { status: 'establishing' })

  return <SessionContext.Provider value={state}>{children}</SessionContext.Provider>
}
