'use client'

import { useEffect, useState } from 'react'
import { fetchMcpUrl } from '@/lib/api'

export type McpUrlState =
  | { status: 'loading' }
  | { status: 'ready'; url: string }
  | { status: 'failed' }

/**
 * The address to paste into an agent, from the one place that knows it.
 *
 * Cached at module scope rather than per component: the value changes on
 * deploy, and the connect dialog mounts in three places on the settings page
 * alone. The promise is cached, not the result, so two mounts in the same tick
 * share one request instead of racing.
 *
 * A rejection clears the cache so a retry can actually retry — a stored
 * rejected promise would make every later mount fail instantly with the first
 * failure, which is a dead dialog until reload.
 */
let pending: Promise<string> | null = null

function load(): Promise<string> {
  pending ??= fetchMcpUrl().catch((err: unknown) => {
    pending = null
    throw err
  })
  return pending
}

export function useMcpUrl(): McpUrlState {
  const [state, setState] = useState<McpUrlState>({ status: 'loading' })

  useEffect(() => {
    let cancelled = false
    void load().then(
      (url) => !cancelled && setState({ status: 'ready', url }),
      () => !cancelled && setState({ status: 'failed' }),
    )
    return () => {
      cancelled = true
    }
  }, [])

  return state
}
