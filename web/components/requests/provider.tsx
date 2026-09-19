'use client'

import { useIdentityToken, usePrivy } from '@privy-io/react-auth'
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { usePrivyAvailable } from '@/components/auth'
import { linkToPlan, listPendingPlans, type Credentials } from '@/lib/api'
import { pollRequests, type RequestsState } from './poll'

interface Requests extends RequestsState {
  refresh: () => void
  open: (id: string) => Promise<string>
}
const initial: RequestsState = { plans: [], loaded: false, failed: false }
const Context = createContext<Requests>({ ...initial, refresh: () => {}, open: async () => { throw new Error('Sign in to open a request') } })
export const useRequests = () => useContext(Context)

export function RequestsProvider({ children }: { children: ReactNode }) {
  return usePrivyAvailable() ? <Connected>{children}</Connected> : <Context.Provider value={{ ...initial, failed: true, refresh: () => {}, open: async () => { throw new Error('Sign in is unavailable') } }}>{children}</Context.Provider>
}

function Connected({ children }: { children: ReactNode }) {
  const { ready, authenticated, user, getAccessToken } = usePrivy()
  const { identityToken } = useIdentityToken()
  const key = ready && authenticated ? user?.id : undefined
  const [result, setResult] = useState<{ key: string; state: RequestsState } | null>(null)
  const refreshRef = useRef<() => void>(() => {})
  const credentials = useCallback(async (): Promise<Credentials> => {
    const accessToken = await getAccessToken()
    if (!accessToken) throw new Error('Sign in to open a request')
    return { accessToken, identityToken }
  }, [getAccessToken, identityToken])

  useEffect(() => {
    if (!key) return
    const poll = pollRequests(async () => listPendingPlans(await credentials()), (state) => setResult({ key, state }))
    refreshRef.current = () => { void poll.refresh() }
    const focus = () => { if (document.visibilityState === 'visible') void poll.refresh() }
    window.addEventListener('focus', focus)
    document.addEventListener('visibilitychange', focus)
    return () => {
      poll.stop()
      refreshRef.current = () => {}
      window.removeEventListener('focus', focus)
      document.removeEventListener('visibilitychange', focus)
    }
  }, [key, credentials])

  const open = useCallback(async (id: string) => {
    try {
      const link = await linkToPlan(await credentials(), id)
      // Keep navigation on this app; the service owns the opaque review token.
      return `/review/${encodeURIComponent(link.token)}`
    } finally {
      refreshRef.current()
    }
  }, [credentials])
  const state = key && result?.key === key ? result.state : initial
  return <Context.Provider value={{ ...state, refresh: () => refreshRef.current(), open }}>{children}</Context.Provider>
}

export function RequestsBadge() {
  const { plans } = useRequests()
  if (!plans.length) return null
  return <span aria-label={`${plans.length} pending requests`} className="ml-1 inline-flex min-w-5 items-center justify-center rounded-full bg-[var(--ot-plan-bg)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--ot-plan-text)]">{plans.length}</span>
}
