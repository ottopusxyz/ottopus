'use client'

import { useIdentityToken, usePrivy } from '@privy-io/react-auth'
import { useCallback, useEffect, useState } from 'react'
import { listAgents, revokeAgent, type AgentGrant } from '@/lib/api'

export type AgentsState =
  | { status: 'loading' }
  | { status: 'ready'; agents: AgentGrant[] }
  | { status: 'failed' }

export interface UseAgents {
  state: AgentsState
  revoke: (id: string) => Promise<void>
  /** Ask again. The connect dialog polls this while it waits for a handshake. */
  refresh: () => void
}

/**
 * The agents this account has authorised.
 *
 * Refetches after a revoke rather than editing the list in place: revoking
 * changes what the row says, not whether it exists, and the service is the one
 * that decides what it now says. Guessing here would be a second description of
 * a revoked grant, drifting from the first.
 */
export function useAgents(): UseAgents {
  const { ready, authenticated, getAccessToken } = usePrivy()
  const { identityToken } = useIdentityToken()
  const [state, setState] = useState<AgentsState>({ status: 'loading' })
  const [nonce, setNonce] = useState(0)

  const credentials = useCallback(async () => {
    const accessToken = await getAccessToken()
    if (!accessToken) throw new Error('Not signed in')
    return { accessToken, identityToken }
  }, [getAccessToken, identityToken])

  useEffect(() => {
    if (!ready || !authenticated) return
    let cancelled = false
    void (async () => {
      try {
        const { agents } = await listAgents(await credentials())
        if (!cancelled) setState({ status: 'ready', agents })
      } catch {
        if (!cancelled) setState({ status: 'failed' })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [ready, authenticated, credentials, nonce])

  const revoke = useCallback(
    async (id: string) => {
      await revokeAgent(await credentials(), id)
      setNonce((n) => n + 1)
    },
    [credentials],
  )

  // Stable, and that is load-bearing rather than tidy: the connect dialog puts
  // this in a setInterval keyed on its identity, so a new function every render
  // would tear the interval down and restart it before it could ever fire.
  const refresh = useCallback(() => setNonce((n) => n + 1), [])

  return { state, revoke, refresh }
}
