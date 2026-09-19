'use client'

import { useIdentityToken, usePrivy } from '@privy-io/react-auth'
import { useCallback, useEffect, useState } from 'react'
import { type Credentials, type PlanSummary, listPlans } from '@/lib/api'

/**
 * Every plan, for the list. Read on mount, again on focus, and again after
 * a row is opened or the badge's poll sees a change; the badge itself keeps
 * polling the pending subset through RequestsProvider, which is the cheaper
 * read and the one that matters for "something new landed".
 */
/** Slower than the badge's five seconds: history moves on the person's own clicks, mostly. */
const HISTORY_POLL_MS = 20_000

export type PlansState =
  | { status: 'loading' }
  | { status: 'failed'; plans: PlanSummary[] }
  | { status: 'ready'; plans: PlanSummary[] }

/**
 * `pendingKey` is the pending set's identities and statuses joined, not its
 * size: one pending request replaced by another leaves the count unchanged,
 * and a blocked arrival never counts at all. The list also re-reads on its
 * own clock, so history that no poll watches still catches up.
 */
export function usePlans(pendingKey: string): { state: PlansState; refresh: () => void } {
  const { getAccessToken } = usePrivy()
  const { identityToken } = useIdentityToken()
  const [state, setState] = useState<PlansState>({ status: 'loading' })
  const [tick, setTick] = useState(0)

  const credentials = useCallback(async (): Promise<Credentials> => {
    const accessToken = await getAccessToken()
    if (!accessToken) throw new Error('not signed in')
    return { accessToken, identityToken }
  }, [getAccessToken, identityToken])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const { plans } = await listPlans(await credentials())
        if (!cancelled) setState({ status: 'ready', plans })
      } catch {
        if (!cancelled) setState((s) => ({ status: 'failed', plans: s.status === 'loading' ? [] : s.plans }))
      }
    })()
    return () => {
      cancelled = true
    }
    // pendingKey is a dependency on purpose: when the badge's poll sees the
    // pending set change in any way, the full list re-reads.
  }, [credentials, tick, pendingKey])

  useEffect(() => {
    const focus = () => {
      if (document.visibilityState === 'visible') setTick((t) => t + 1)
    }
    const clock = setInterval(() => {
      if (document.visibilityState === 'visible') setTick((t) => t + 1)
    }, HISTORY_POLL_MS)
    window.addEventListener('focus', focus)
    return () => {
      clearInterval(clock)
      window.removeEventListener('focus', focus)
    }
  }, [])

  return { state, refresh: () => setTick((t) => t + 1) }
}
