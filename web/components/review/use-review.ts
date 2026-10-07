'use client'

import { useIdentityToken, usePrivy } from '@privy-io/react-auth'
import { useCallback, useEffect, useRef, useState } from 'react'
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
  // A read sent before a transition can land after it, carrying the status
  // the transition just left: a poll answering `approved` a moment after a
  // withdrawal wrote `cancelled` would put the wait back on the page. Every
  // write that lands moves the epoch on, and a read only lands in its own.
  const epoch = useRef(0)

  const credentials = useCallback(async (): Promise<Credentials> => {
    const accessToken = await getAccessToken()
    if (!accessToken) throw new ApiError(401, 'not signed in')
    return { accessToken, identityToken }
  }, [getAccessToken, identityToken])

  useEffect(() => {
    let cancelled = false
    const sent = epoch.current
    void (async () => {
      try {
        const read = await readReview(await credentials(), token)
        if (!cancelled && epoch.current === sent) setState({ status: 'ready', read })
      } catch (err) {
        if (cancelled || epoch.current !== sent) return
        const gone = err instanceof ApiError && err.status === 404
        // A re-read that fails leaves the page on what it last knew; only a
        // first read has nothing to show. A dead link is dead either way.
        setState((held) => (gone ? { status: 'gone' } : held.status === 'ready' ? held : { status: 'unreachable' }))
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
      let status: PlanStatusName
      try {
        ;({ status } = await movePlan(await credentials(), plan.id, plan.version, transition))
      } catch (err) {
        // A 409 is the machine saying the plan is not where this page thinks
        // it is, so what the page holds is stale and a re-read follows. For
        // an outcome the chain has already decided — the receipt job races
        // this page to confirmed and failed — the refusal means the service
        // knows it too, and the person is told nothing went wrong.
        if (!(err instanceof ApiError && err.status === 409)) throw err
        setTick((t) => t + 1)
        const decided = transition.status === 'confirmed' || transition.status === 'failed'
        if (!decided) throw err
        return transition.status
      }
      // What this transition carried is now the latest detail — the hash on
      // submitted and on confirmed — exactly as a re-read would report it.
      // Without this a page that signed a plan itself reached "settled" with
      // the detail of the event it opened on, which has no hash in it.
      const statusDetail = 'detail' in transition && transition.detail ? transition.detail : state.read.statusDetail
      epoch.current += 1
      setState({
        status: 'ready',
        read: { ...state.read, plan: { ...plan, status }, statusAt: new Date().toISOString(), statusDetail },
      })
      return status
    },
    [state, credentials],
  )

  const reload = useCallback(() => setTick((t) => t + 1), [])

  return { state, move, reload }
}
