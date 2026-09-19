'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { Plan } from '@/lib/api'
import { type BrowserSimulation, type Eip1193, type NativeWords, simulatePlan } from '@/lib/simulate'

/**
 * The page's own simulation, run in the browser when the plan is opened.
 *
 * Why here and not only on the service: the stored run describes the block
 * the plan was built against, and somebody opening a link is reading minutes
 * later. Balances move, allowances get spent, a token pauses. The run that
 * matters to a person about to sign is the one against the chain as it is,
 * and the browser is where "as it is" means now.
 *
 * It starts once per plan version and can be asked again — before submitting,
 * or by the person. It never blocks the page: the plan renders immediately
 * from what the service stored, and this replaces it when it lands.
 */

export type SimulationState =
  | { kind: 'idle' }
  | { kind: 'running' }
  | { kind: 'done'; run: BrowserSimulation }
  /** The chain would not answer. Not a verdict, and never shown as one. */
  | { kind: 'unavailable' }

export interface UseSimulation {
  state: SimulationState
  /** The live run, or null while there is none. */
  run: BrowserSimulation | null
  /** Run it again. Resolves to the run, or null if the chain would not answer. */
  again: (provider?: Eip1193 | null) => Promise<BrowserSimulation | null>
}

export function useSimulation(
  plan: Plan | null,
  chainId: string | null,
  native: NativeWords | null,
): UseSimulation {
  const [state, setState] = useState<SimulationState>({ kind: 'idle' })
  // Keyed on the hash, so a plan that is replaced by a new version simulates
  // again and one that merely re-renders does not.
  const started = useRef<string | null>(null)
  const live = useRef(true)

  useEffect(() => {
    live.current = true
    return () => {
      live.current = false
    }
  }, [])

  const go = useCallback(
    async (provider?: Eip1193 | null): Promise<BrowserSimulation | null> => {
      if (!plan || !chainId || !native) return null
      setState({ kind: 'running' })
      try {
        const run = await simulatePlan(plan, chainId, native, { provider: provider ?? null })
        if (live.current) setState({ kind: 'done', run })
        return run
      } catch {
        // A chain that will not answer says nothing about the plan. The page
        // falls back to what the service stored and says which it is showing.
        if (live.current) setState({ kind: 'unavailable' })
        return null
      }
    },
    [plan, chainId, native],
  )

  useEffect(() => {
    if (!plan || !chainId || !native) return
    if (started.current === plan.planHash) return
    started.current = plan.planHash
    void go()
  }, [plan, chainId, native, go])

  return { state, run: state.kind === 'done' ? state.run : null, again: go }
}
