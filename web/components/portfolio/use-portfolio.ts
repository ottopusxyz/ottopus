'use client'

import { useIdentityToken, usePrivy } from '@privy-io/react-auth'
import { useCallback, useEffect, useState } from 'react'
import { ApiError, getPortfolio, type Arm, type Credentials, type Portfolio } from '@/lib/api'

/**
 * The numbers, read from the service.
 *
 * Separate from `useWallets` on purpose. Which arms exist and what is in them
 * are two questions with two failure modes: a portfolio provider being down
 * says nothing about whether a wallet is linked, and the page has to keep
 * showing the arms either way.
 *
 * The browser never holds a portfolio provider's key — the service reads Zerion
 * and this reads the service.
 */

export type PortfolioFailure = 'unreachable' | 'unconfigured'

/**
 * `failed` keeps the last portfolio, for the same reason `useWallets` keeps the
 * last arms: a refresh that could not reach the service has said nothing about
 * what the balances are. Replacing $12,431 with $0 because a fetch timed out is
 * the worst thing this screen can do.
 */
export type PortfolioState =
  | { status: 'loading' }
  | { status: 'ready'; portfolio: Portfolio }
  | { status: 'failed'; reason: PortfolioFailure; portfolio: Portfolio | null }

/** Whatever we last knew, whether or not the last read succeeded. */
export function portfolioOf(state: PortfolioState): Portfolio | null {
  return state.status === 'loading' ? null : (state.portfolio ?? null)
}

export interface UsePortfolio {
  state: PortfolioState
  refresh: () => void
}

/** Read again when the linked wallet set changes, including same-count replacements. */
export function usePortfolio(wallets: readonly Arm[], enabled = true): UsePortfolio {
  const { ready, authenticated, getAccessToken, user } = usePrivy()
  const { identityToken } = useIdentityToken()
  const walletKey = JSON.stringify(wallets.map((arm) => arm.id).sort())
  const key = `${user?.id ?? ''}:${walletKey}`
  const [result, setResult] = useState<{ key: string; state: PortfolioState } | null>(null)
  const [nonce, setNonce] = useState(0)
  const credentials = useCallback(async (): Promise<Credentials> => {
    const accessToken = await getAccessToken()
    if (!accessToken) throw new Error('Not signed in')
    return { accessToken, identityToken }
  }, [getAccessToken, identityToken])

  useEffect(() => {
    if (!ready || !authenticated || !enabled || walletKey === '[]') return
    let cancelled = false
    void (async () => {
      try {
        const creds = await credentials()
        if (cancelled) return
        const portfolio = await getPortfolio(creds)
        if (!cancelled) setResult({ key, state: { status: 'ready', portfolio } })
      } catch (error) {
        if (cancelled) return
        const reason: PortfolioFailure =
          error instanceof ApiError && error.status === 503 ? 'unconfigured' : 'unreachable'
        setResult((previous) => ({
          key,
          state: {
            status: 'failed', reason,
            portfolio: previous?.key === key ? portfolioOf(previous.state) : null,
          },
        }))
      }
    })()
    return () => { cancelled = true }
  }, [ready, authenticated, enabled, walletKey, key, nonce, credentials])

  return {
    state: ready && authenticated && enabled && result?.key === key
      ? result.state : { status: 'loading' },
    refresh: () => setNonce((n) => n + 1),
  }
}

/** What to say when the balances could not be read. Never blocks the arms. */
export function portfolioFailureText(reason: PortfolioFailure): {
  title: string
  body: string
} {
  return reason === 'unconfigured'
    ? {
        title: 'Balances aren’t switched on',
        body: 'Your wallets are linked, but balances are temporarily unavailable. Try again later.',
      }
    : {
        title: 'Otto couldn’t read your balances',
        body: 'Your wallets are still linked. Try refreshing to read your balances again.',
      }
}

/**
 * Arms whose balances are missing from the total, with a reason.
 *
 * Surfaced rather than swallowed: a total quietly missing one of eight wallets
 * is a number someone would act on.
 */
export function unreadArms(portfolio: Portfolio | null): Portfolio['arms'] {
  return portfolio?.arms.filter((arm) => arm.status !== 'ok') ?? []
}
