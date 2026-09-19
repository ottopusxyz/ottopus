'use client'

import { useIdentityToken, usePrivy } from '@privy-io/react-auth'
import { useCallback, useEffect, useState } from 'react'
import { ApiError, type Credentials, type PlanStatusName, type ReviewRead, type WebTransition, movePlan, readReview } from '@/lib/api'

/**
 * The plan behind the link, and the transitions the page may write.
 *
 * `gone` covers every way a link can be dead — tampered, expired, superseded,
 * someone else's — because the service answers all four with one 404 and the
 * page must not tell them apart either.
 */
export type ReviewState =
  | { status: 'loading' }
  | { status: 'gone' }
  | { status: 'unreachable' }
  | { status: 'ready'; read: ReviewRead }

export interface UseReview {
  state: ReviewState
  /** Write a transition and reflect the new status locally. */
  move: (transition: WebTransition) => Promise<PlanStatusName>
  reload: () => void
}

export function useReview(token: string): UseReview {
  const { getAccessToken } = usePrivy()
  const { identityToken } = useIdentityToken()
  const [state, setState] = useState<ReviewState>({ status: 'loading' })
  const [tick, setTick] = useState(0)

  const credentials = useCallback(async (): Promise<Credentials> => {
    const accessToken = await getAccessToken()
    if (!accessToken) throw new ApiError(401, 'not signed in')
    return { accessToken, identityToken }
  }, [getAccessToken, identityToken])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const read = await readReview(await credentials(), token)
        if (!cancelled) setState({ status: 'ready', read })
      } catch (err) {
        if (cancelled) return
        setState(err instanceof ApiError && err.status === 404 ? { status: 'gone' } : { status: 'unreachable' })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [token, credentials, tick])

  const move = useCallback(
    async (transition: WebTransition) => {
      if (state.status !== 'ready') throw new Error('no plan loaded')
      const { plan } = state.read
      const { status } = await movePlan(await credentials(), plan.id, plan.version, transition)
      setState({ status: 'ready', read: { ...state.read, plan: { ...plan, status }, statusAt: new Date().toISOString() } })
      return status
    },
    [state, credentials],
  )

  const reload = useCallback(() => setTick((t) => t + 1), [])

  return { state, move, reload }
}
