'use client'

import { useIdentityToken, usePrivy } from '@privy-io/react-auth'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { ApiError, getActivity, type ActivityFeed, type ActivityKind, type ActivityRow, type Credentials } from '@/lib/api'
import { rowKey } from './activity'

/**
 * The feed, read from the service a page at a time.
 *
 * The filters are part of the key: changing one starts over from the top,
 * because a cursor written for one filter set is meaningless under another.
 * The chains seen so far accumulate across pages and survive a filter
 * change, so the network picker does not forget a chain the moment it is
 * picked.
 */

export type ActivityFailure = 'unreachable' | 'unconfigured'

export interface ActivityFilters {
  wallet: string | null
  chain: string | null
  kinds: readonly ActivityKind[] | null
}

export type ActivityState =
  | { status: 'loading' }
  | { status: 'ready'; rows: ActivityRow[]; cursor: string | null; arms: ActivityFeed['arms']; more: 'idle' | 'loading' | 'failed' }
  | { status: 'failed'; reason: ActivityFailure }

export interface UseActivity {
  state: ActivityState
  /** Every chain any page has shown, for the filter to offer. */
  chains: ActivityFeed['chains']
  refresh: () => void
  loadMore: () => void
}

const PAGE_SIZE = 25

export function useActivity(filters: ActivityFilters, enabled = true): UseActivity {
  const { ready, authenticated, getAccessToken, user } = usePrivy()
  const { identityToken } = useIdentityToken()
  const key = `${user?.id ?? ''}:${filters.wallet ?? ''}:${filters.chain ?? ''}:${filters.kinds?.join(',') ?? ''}`
  const [result, setResult] = useState<{ key: string; state: ActivityState } | null>(null)
  const [chains, setChains] = useState<ActivityFeed['chains']>([])
  const [nonce, setNonce] = useState(0)

  const credentials = useCallback(async (): Promise<Credentials> => {
    const accessToken = await getAccessToken()
    if (!accessToken) throw new Error('Not signed in')
    return { accessToken, identityToken }
  }, [getAccessToken, identityToken])

  const remember = useCallback((seen: ActivityFeed['chains']) => {
    setChains((known) => {
      const fresh = seen.filter((chain) => !known.some((k) => k.chainId === chain.chainId))
      return fresh.length === 0 ? known : [...known, ...fresh].sort((a, b) => a.name.localeCompare(b.name))
    })
  }, [])

  useEffect(() => {
    if (!ready || !authenticated || !enabled) return
    let cancelled = false
    void (async () => {
      try {
        const feed = await getActivity(await credentials(), {
          wallet: filters.wallet,
          chain: filters.chain,
          kinds: filters.kinds,
          size: PAGE_SIZE,
        })
        if (cancelled) return
        remember(feed.chains)
        setResult({ key, state: { status: 'ready', rows: feed.items, cursor: feed.cursor, arms: feed.arms, more: 'idle' } })
      } catch (error) {
        if (cancelled) return
        const reason: ActivityFailure = error instanceof ApiError && error.status === 503 ? 'unconfigured' : 'unreachable'
        setResult({ key, state: { status: 'failed', reason } })
      }
    })()
    return () => {
      cancelled = true
    }
    // The filters are folded into `key`; listing them too would only re-run the read for the same key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, authenticated, enabled, key, nonce, credentials, remember])

  const live = ready && authenticated && enabled && result?.key === key
  const state = useMemo<ActivityState>(() => (live && result ? result.state : { status: 'loading' }), [live, result])

  const loadMore = useCallback(() => {
    if (state.status !== 'ready' || !state.cursor || state.more === 'loading') return
    const { cursor } = state
    setResult((current) =>
      current?.key === key && current.state.status === 'ready' ? { key, state: { ...current.state, more: 'loading' } } : current,
    )
    void (async () => {
      try {
        const feed = await getActivity(await credentials(), {
          wallet: filters.wallet,
          chain: filters.chain,
          kinds: filters.kinds,
          cursor,
          size: PAGE_SIZE,
        })
        remember(feed.chains)
        setResult((current) => {
          if (current?.key !== key || current.state.status !== 'ready' || current.state.cursor !== cursor) return current
          // Keyed so a row that arrives twice — a refresh racing a page — draws once.
          const have = new Set(current.state.rows.map(rowKey))
          const rows = [...current.state.rows, ...feed.items.filter((row) => !have.has(rowKey(row)))]
          return { key, state: { status: 'ready', rows, cursor: feed.cursor, arms: feed.arms, more: 'idle' } }
        })
      } catch {
        setResult((current) =>
          current?.key === key && current.state.status === 'ready' ? { key, state: { ...current.state, more: 'failed' } } : current,
        )
      }
    })()
  }, [state, key, credentials, remember, filters.wallet, filters.chain, filters.kinds])

  return { state, chains, refresh: () => setNonce((n) => n + 1), loadMore }
}
