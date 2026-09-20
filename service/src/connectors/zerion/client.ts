/**
 * The HTTP half of every Zerion connector: auth, timeouts, retries, and the
 * chain list, shared by the portfolio and activity readers so the vendor's
 * error vocabulary is translated in one place.
 *
 * Errors come out as `PortfolioError` whatever the endpoint — the codes name
 * what went wrong with the provider, not which numbers were being asked for,
 * and every caller already reads them.
 */

import { ChainMap, type ChainEntry } from '../portfolio/chains.js'
import { PortfolioError } from '../portfolio/types.js'

const DEFAULT_BASE_URL = 'https://api.zerion.io/v1'

/** A page load waits on this. Long enough for a cold wallet, short enough to fail. */
const DEFAULT_TIMEOUT_MS = 10_000

/** Retrying inside a request is only worth it when the wait is shorter than the request. */
const MAX_RETRY_WAIT_MS = 2_000
const MAX_ATTEMPTS = 3

/** What `AbortSignal.timeout` rejects a fetch with; an abort by any other hand looks the same and means the same. */
function isTimeout(err: unknown): boolean {
  return err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')
}

export interface ZerionClientOptions {
  apiKey: string
  baseUrl?: string
  timeoutMs?: number
  /** Injectable for tests. Defaults to the global. */
  fetch?: typeof globalThis.fetch
  /** Testnet data lives in a separate environment behind this header. */
  testnet?: boolean
}

export interface ZerionListResponse<T> {
  data?: T[]
  links?: { next?: string | null }
}

export class ZerionClient {
  readonly baseUrl: string
  private readonly authorization: string
  private readonly timeoutMs: number
  private readonly doFetch: typeof globalThis.fetch
  private readonly testnet: boolean

  /**
   * One chain list per process. It changes when Zerion adds a chain, which is
   * not inside the lifetime of a request — and holding the promise rather than
   * the result is what stops eight arms loading it eight times in parallel.
   */
  private chains: Promise<ChainMap> | null = null
  private loadedChains: ChainMap | null = null

  constructor(options: ZerionClientOptions) {
    if (!options.apiKey) {
      throw new PortfolioError('not_configured', 'ZERION_API_KEY is not set')
    }
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, '')
    // Basic auth with the key as the username and an empty password. The
    // trailing colon is not optional — without it the key is not a credential.
    this.authorization = `Basic ${Buffer.from(`${options.apiKey}:`).toString('base64')}`
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
    this.doFetch = options.fetch ?? globalThis.fetch
    this.testnet = options.testnet ?? false
  }

  chainName(chainId: string): string | null {
    return this.loadedChains?.nameOf(chainId) ?? null
  }

  chainIcon(chainId: string): string | null {
    return this.loadedChains?.iconOf(chainId) ?? null
  }

  chainMap(): Promise<ChainMap> {
    // Cached as a promise, not a value: a rejected load must not be cached, or
    // one bad boot poisons every later request.
    this.chains ??= this.loadChains().catch((err: unknown) => {
      this.chains = null
      throw err
    })
    return this.chains
  }

  private async loadChains(): Promise<ChainMap> {
    const body = await this.get<
      ZerionListResponse<{ id?: string; attributes?: { name?: string; external_id?: string; icon?: { url?: string | null } } }>
    >(`${this.baseUrl}/chains/`)

    const entries: ChainEntry[] = []
    for (const item of body.data ?? []) {
      if (!item.id) continue
      entries.push({
        id: item.id,
        name: item.attributes?.name ?? item.id,
        externalId: item.attributes?.external_id,
        iconUrl: item.attributes?.icon?.url ?? null,
      })
    }

    if (entries.length === 0) {
      throw new PortfolioError('unavailable', 'zerion returned an empty chain list')
    }
    this.loadedChains = new ChainMap(entries)
    return this.loadedChains
  }

  async get<T>(url: string): Promise<T> {
    let lastError: PortfolioError | null = null

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      let response: Response
      try {
        const headers: Record<string, string> = {
          authorization: this.authorization,
          accept: 'application/json',
        }
        if (this.testnet) headers['X-Env'] = 'testnet'

        response = await this.doFetch(url, {
          headers,
          signal: AbortSignal.timeout(this.timeoutMs),
        })
      } catch (err) {
        lastError = new PortfolioError('unavailable', 'zerion did not answer', { cause: err })
        // A timeout is not a blip to retry through: the provider is hanging,
        // and three waits in a row turned a ten-second ceiling into thirty,
        // on every arm, for every request. One wait, then the arm reads as
        // unavailable and the cache answers the next caller. A connection
        // that dropped is a blip, and still gets its retries.
        if (isTimeout(err) || attempt === MAX_ATTEMPTS) break
        continue
      }

      if (response.ok) {
        try {
          return (await response.json()) as T
        } catch (err) {
          throw new PortfolioError('unavailable', 'zerion sent something that is not JSON', {
            cause: err,
          })
        }
      }

      const detail = await errorDetail(response)

      // An address Zerion does not track — a token contract, an exchange hot
      // wallet, a burn address. A pasted watch-only arm can be any of them, and
      // this is a fact about that arm, not a failure to fix by retrying.
      if (response.status === 400 && /not trackable|not tracked/i.test(detail)) {
        throw new PortfolioError('untracked_address', detail || 'zerion does not track this address')
      }
      if (response.status === 400 || response.status === 404 || response.status === 422) {
        throw new PortfolioError('unavailable', `zerion rejected the request: ${detail}`)
      }
      if (response.status === 401 || response.status === 403) {
        throw new PortfolioError('not_configured', 'zerion rejected the API key')
      }

      if (response.status === 429) {
        // Day and month quotas do not come back inside a request, so only the
        // per-second limit is worth waiting on.
        const wait = retryWaitMs(response)
        if (wait === null || attempt === MAX_ATTEMPTS) {
          throw new PortfolioError('rate_limited', 'zerion rate limit reached')
        }
        lastError = new PortfolioError('rate_limited', 'zerion rate limit reached')
        await sleep(wait)
        continue
      }

      lastError = new PortfolioError('unavailable', `zerion answered ${response.status}`)
      if (attempt === MAX_ATTEMPTS) break

      // 503 means the data is still being prepared and carries Retry-After.
      const wait = response.status === 503 ? retryWaitMs(response) : 250 * attempt
      if (wait === null) break
      await sleep(wait)
    }

    throw lastError ?? new PortfolioError('unavailable', 'zerion did not answer')
  }
}

async function errorDetail(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { errors?: { title?: string; detail?: string }[] }
    const first = body.errors?.[0]
    return first?.detail ?? first?.title ?? ''
  } catch {
    return ''
  }
}

/** Null when the wait is longer than the request is worth. */
function retryWaitMs(response: Response): number | null {
  const seconds =
    response.headers.get('retry-after') ?? response.headers.get('ratelimit-org-second-reset')
  const parsed = seconds === null ? 1 : Number(seconds)
  if (!Number.isFinite(parsed) || parsed < 0) return null
  const ms = Math.max(parsed * 1000, 100)
  return ms > MAX_RETRY_WAIT_MS ? null : ms
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
