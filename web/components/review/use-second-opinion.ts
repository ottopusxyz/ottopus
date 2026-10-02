'use client'

import { useIdentityToken, usePrivy } from '@privy-io/react-auth'
import { useEffect, useRef, useState } from 'react'
import { type BinanceSimulation, type Plan, simulateWithBinance } from '@/lib/api'

/**
 * Binance's simulation of the plan, fetched once the page's own has settled.
 *
 * After, never beside: the page's run is the one a person is waiting on, and
 * a second source must not cost it a request slot or a paint. `ready` is the
 * caller saying its own run has finished, passed or not. Asked once per plan
 * version. Any failure to fetch is null — the same quiet nothing as a vendor
 * that did not answer — because this is advice and its absence is not news.
 */
export function useSecondOpinion(plan: Plan | null, ready: boolean): BinanceSimulation | null {
  const { getAccessToken } = usePrivy()
  const { identityToken } = useIdentityToken()
  const [found, setFound] = useState<{ planHash: string; result: BinanceSimulation } | null>(null)
  const started = useRef<string | null>(null)
  const live = useRef(true)

  useEffect(() => {
    live.current = true
    return () => {
      live.current = false
    }
  }, [])

  useEffect(() => {
    if (!plan || !ready) return
    if (started.current === plan.planHash) return
    started.current = plan.planHash
    const { id, planHash } = plan
    // Not cancelled by this effect's own cleanup: it re-runs when a token
    // refreshes, and the request it already sent is still the answer.
    void (async () => {
      try {
        const accessToken = await getAccessToken()
        if (!accessToken) return
        const result = await simulateWithBinance({ accessToken, identityToken }, id)
        if (live.current) setFound({ planHash, result })
      } catch {
        // Nothing to show, and nothing to say about it.
      }
    })()
  }, [plan, ready, getAccessToken, identityToken])

  // A result for an older version of the plan is not about this one.
  return found && plan && found.planHash === plan.planHash ? found.result : null
}
