/**
 * A short memory in front of a portfolio provider.
 *
 * Eight arms means eight provider calls per page load, and a portfolio page
 * mounts more than once — a tab switch, a React strict-mode double mount, two
 * open tabs. Without this, ordinary use spends the rate limit.
 *
 * Deliberately in process rather than in Postgres: no migration, nothing to
 * keep consistent, and one Railway instance is what we run. The trade is that
 * it is cold after every deploy and wrong the day we run two instances — at
 * which point this file becomes the seam where a shared store goes, and nothing
 * above it changes.
 *
 * A decorator rather than something the route calls, so the aggregate and the
 * route never learn that caching exists.
 */

import type { AccountPosition, AccountRef, PortfolioConnector } from './types.js'

const DEFAULT_TTL_MS = 60_000

/**
 * Enough for a demo's worth of users. Past it the oldest entries go, which is
 * the right failure: a cache is an optimisation, and forgetting is free.
 */
const DEFAULT_MAX_ENTRIES = 2_000

export interface CacheOptions {
  ttlMs?: number
  maxEntries?: number
  /** Injectable so tests do not wait out a real minute. */
  now?: () => number
}

interface Entry {
  expiresAt: number
  positions: AccountPosition[]
}

function keyOf(account: AccountRef): string {
  return `${account.namespace}:${account.address.toLowerCase()}`
}

/**
 * Wrap a connector so repeated reads of one account inside the TTL cost one
 * provider call.
 *
 * Failures are **not** cached — an arm that failed because the vendor blinked
 * should be retried on the next page load, not held wrong for a minute. They
 * are still coalesced, so eight arms failing together make one call each rather
 * than a stampede.
 */
export function cached(
  connector: PortfolioConnector,
  options: CacheOptions = {},
): PortfolioConnector {
  const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS
  const maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES
  const now = options.now ?? Date.now

  const entries = new Map<string, Entry>()
  /** In-flight reads, so two callers asking at once make one call. */
  const pending = new Map<string, Promise<AccountPosition[]>>()

  function evictIfFull(): void {
    if (entries.size <= maxEntries) return
    // Map iterates in insertion order, so the first key is the oldest write.
    for (const key of entries.keys()) {
      entries.delete(key)
      if (entries.size <= maxEntries) break
    }
  }

  const wrapped: PortfolioConnector = {
    provider: connector.provider,

    async positionsFor(account: AccountRef): Promise<AccountPosition[]> {
      const key = keyOf(account)

      const hit = entries.get(key)
      if (hit && hit.expiresAt > now()) return hit.positions
      if (hit) entries.delete(key)

      const inFlight = pending.get(key)
      if (inFlight) return inFlight

      const read = connector
        .positionsFor(account)
        .then((positions) => {
          entries.set(key, { expiresAt: now() + ttlMs, positions })
          evictIfFull()
          return positions
        })
        .finally(() => {
          pending.delete(key)
        })

      pending.set(key, read)
      return read
    },
  }

  // Only forwarded when the wrapped connector has one, so `chainName` in
  // wrapped is absent rather than present-and-undefined.
  if (connector.chainName) {
    wrapped.chainName = (chainId: string) => connector.chainName!(chainId)
  }
  if (connector.chainIcon) {
    wrapped.chainIcon = (chainId: string) => connector.chainIcon!(chainId)
  }
  return wrapped
}
