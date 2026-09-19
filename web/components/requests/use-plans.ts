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
export type PlansState =
  | { status: 'loading' }
  | { status: 'failed'; plans: PlanSummary[] }
  | { status: 'ready'; plans: PlanSummary[] }

export function usePlans(pendingCount: number): { state: PlansState; refresh: () => void } {
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
    // pendingCount is a dependency on purpose: when the badge's poll sees the
    // pending set change, the full list re-reads.
  }, [credentials, tick, pendingCount])

  useEffect(() => {
    const focus = () => {
      if (document.visibilityState === 'visible') setTick((t) => t + 1)
    }
    window.addEventListener('focus', focus)
    return () => window.removeEventListener('focus', focus)
  }, [])

  return { state, refresh: () => setTick((t) => t + 1) }
}
