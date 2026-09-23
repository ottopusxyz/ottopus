import { createHmac, randomUUID } from 'node:crypto'

/**
 * The HTTP half of every Binance Web3 API connector: signing, the clock, rate
 * limits and the response envelope, in one place so a route provider, a token
 * registry and a simulator never each learn the vendor's quirks.
 *
 * Every endpoint is authenticated. The signature is HMAC-SHA256 over
 * `timestamp + METHOD + requestPath + body`, where `requestPath` carries the
 * `/build` prefix and the raw query string — the same bytes the request is
 * sent with. Getting the prefix into the signed path is the classic mistake,
 * which is why `signBinanceRequest` is exported and pinned by a fixed vector.
 *
 * The clock matters. Binance rejects a timestamp outside its receive window,
 * and the default window is five seconds — which a laptop whose clock is not
 * synced fails on the first call. The client always asks for the maximum
 * window, and when the vendor still says no it reads the server's own time
 * out of the refusal, learns the offset, and tries once more.
 *
 * Every attempt carries a fresh nonce. Without one the vendor uses the
 * signature itself for replay detection, and a signature is a function of
 * the timestamp, the path and the body — so two identical requests inside
 * twice the receive window are, to the vendor, one request replayed. Three
 * of four identical concurrent calls were refused that way, and so was the
 * same call repeated a moment later. A random nonce per attempt is what
 * makes two honest requests two requests.
 *
 * The secret never leaves the service. Nothing in `web/` imports this.
 */

export const BINANCE_API_URL = 'https://web3.binance.com/build'

/** The widest window the vendor allows. Sent always: a narrow one buys nothing. */
const RECV_WINDOW_MS = 60_000

/** A prepare call waits on this. The vendor answered in under a second when measured. */
const DEFAULT_TIMEOUT_MS = 10_000

/** Retrying inside a request is only worth it when the wait is shorter than the request. */
const MAX_RETRY_WAIT_MS = 2_000

/**
 * The vendor's one code for both "timestamp outside the receive window" and
 * "request replayed". The message tells them apart: the first names the
 * server's time, the second says "Duplicate request detected".
 */
const CODE_BAD_TIMESTAMP = 40103

export type BinanceErrorCode =
  /** No key, or a key the vendor refused. */
  | 'not_configured'
  /** Could not be reached, timed out, or answered with something unusable. */
  | 'unavailable'
  /** The per-endpoint or per-key limit, after one wait. */
  | 'rate_limited'
  /** The vendor answered and said no. `vendorCode` says why, in its words. */
  | 'rejected'

export class BinanceError extends Error {
  constructor(
    readonly code: BinanceErrorCode,
    message: string,
    /** The `code` field of the envelope, when the vendor answered at all. */
    readonly vendorCode: number | null = null,
    options?: ErrorOptions,
  ) {
    super(message, options)
    this.name = 'BinanceError'
  }
}

/** What every endpoint answers with, success or not. */
export interface BinanceEnvelope<T> {
  code?: number
  msg?: string
  data?: T
  success?: boolean
}

export interface BinanceClientOptions {
  apiKey: string
  secretKey: string
  /** Origin and prefix. The prefix is part of what gets signed, so it lives here and nowhere else. */
  baseUrl?: string
  timeoutMs?: number
  /** Injectable for tests. Defaults to the global. */
  fetch?: typeof globalThis.fetch
  /** Milliseconds since the epoch, for a test to pin the timestamp. */
  now?: () => number
  sleep?: (ms: number) => Promise<void>
  /** One per attempt. Random by default; a test may want to see it. */
  nonce?: () => string
}

export interface SignInput {
  secretKey: string
  /** ISO 8601 with milliseconds, exactly as sent in `X-OC-TIMESTAMP`. */
  timestamp: string
  method: 'GET' | 'POST'
  /** Path with the `/build` prefix and the raw query string, exactly as requested. */
  requestPath: string
  /** The raw body for a POST; the empty string for a GET. */
  body: string
}

/** The signature, on its own, so a fixed vector can hold it to the vendor's scheme. */
export function signBinanceRequest({ secretKey, timestamp, method, requestPath, body }: SignInput): string {
  return createHmac('sha256', secretKey).update(`${timestamp}${method}${requestPath}${body}`, 'utf8').digest('base64')
}

export type Query = Record<string, string | number | boolean | undefined>

/** What `AbortSignal.timeout` rejects a fetch with; an abort by any other hand looks the same and means the same. */
function isTimeout(err: unknown): boolean {
  return err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')
}

export class BinanceClient {
  readonly baseUrl: string
  private readonly origin: string
  private readonly prefix: string
  private readonly apiKey: string
  private readonly secretKey: string
  private readonly timeoutMs: number
  private readonly doFetch: typeof globalThis.fetch
  private readonly now: () => number
  private readonly sleep: (ms: number) => Promise<void>
  private readonly nonce: () => string
  /**
   * How far this machine's clock is from the vendor's, learned from the
   * vendor's own refusal. Kept for the process: a clock does not drift
   * between two requests, and re-learning it costs a round trip each time.
   */
  private clockOffsetMs = 0

  constructor(options: BinanceClientOptions) {
    if (!options.apiKey || !options.secretKey) {
      throw new BinanceError('not_configured', 'BINANCE_WEB3_API_KEY and BINANCE_WEB3_SECRET_KEY are not both set')
    }
    this.baseUrl = (options.baseUrl ?? BINANCE_API_URL).replace(/\/$/, '')
    const url = new URL(this.baseUrl)
    this.origin = url.origin
    this.prefix = url.pathname.replace(/\/$/, '')
    this.apiKey = options.apiKey
    this.secretKey = options.secretKey
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
    this.doFetch = options.fetch ?? globalThis.fetch
    this.now = options.now ?? Date.now
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)))
    this.nonce = options.nonce ?? randomUUID
  }

  /** The learned skew, for a log line or a test. Zero until the vendor has complained. */
  get clockOffset(): number {
    return this.clockOffsetMs
  }

  /** `data` of a successful envelope. A path starts with `/api/…`; the prefix is added here. */
  get<T>(path: string, query?: Query): Promise<T> {
    return this.request<T>('GET', path, query, '')
  }

  post<T>(path: string, body: unknown, query?: Query): Promise<T> {
    return this.request<T>('POST', path, query, JSON.stringify(body))
  }

  private async request<T>(method: 'GET' | 'POST', path: string, query: Query | undefined, body: string): Promise<T> {
    const requestPath = `${this.prefix}${path}${queryString(query)}`
    // Two chances only, and each for one named reason: the clock, or the rate
    // limit. Anything else the vendor says is the answer.
    let retriedClock = false
    let waitedRateLimit = false

    for (;;) {
      const timestamp = new Date(this.now() + this.clockOffsetMs).toISOString()
      const headers: Record<string, string> = {
        'X-OC-APIKEY': this.apiKey,
        'X-OC-TIMESTAMP': timestamp,
        'X-OC-SIGN': signBinanceRequest({ secretKey: this.secretKey, timestamp, method, requestPath, body }),
        'X-OC-RECV-WINDOW': String(RECV_WINDOW_MS),
        'X-OC-NONCE': this.nonce(),
        accept: 'application/json',
      }
      if (method === 'POST') headers['content-type'] = 'application/json'

      let response: Response
      try {
        response = await this.doFetch(`${this.origin}${requestPath}`, {
          method,
          headers,
          ...(method === 'POST' ? { body } : {}),
          signal: AbortSignal.timeout(this.timeoutMs),
        })
      } catch (err) {
        throw new BinanceError('unavailable', isTimeout(err) ? 'binance did not answer in time' : 'binance could not be reached', null, {
          cause: err,
        })
      }

      if (response.status === 429) {
        const wait = retryWaitMs(response)
        if (wait !== null && !waitedRateLimit) {
          waitedRateLimit = true
          await this.sleep(wait)
          continue
        }
        throw new BinanceError('rate_limited', 'binance rate limit reached')
      }

      const envelope = await readEnvelope<T>(response)

      // The vendor names the time it wanted. Learn the difference once and
      // ask again; a second refusal means the problem is not the clock.
      if (envelope?.code === CODE_BAD_TIMESTAMP && !retriedClock) {
        const serverTime = serverTimeIn(envelope.msg)
        if (serverTime !== null) {
          this.clockOffsetMs = serverTime - this.now()
          retriedClock = true
          continue
        }
      }

      // The same code, no server time: the vendor saw this request before.
      // That is a fact about the request, not the key.
      if (envelope?.code === CODE_BAD_TIMESTAMP) {
        throw new BinanceError('rejected', `binance refused (${envelope.code}): ${envelope.msg ?? 'timestamp or replay'}`, envelope.code)
      }
      if (response.status === 401 || response.status === 403) {
        throw new BinanceError(
          'not_configured',
          `binance rejected the API key${envelope?.msg ? `: ${envelope.msg}` : ''}`,
          envelope?.code ?? null,
        )
      }
      if (envelope === null) {
        throw new BinanceError('unavailable', `binance answered ${response.status} with something that is not JSON`)
      }
      if (!response.ok) {
        throw new BinanceError(
          response.status >= 500 ? 'unavailable' : 'rejected',
          `binance answered ${response.status}${envelope.msg ? `: ${envelope.msg}` : ''}`,
          envelope.code ?? null,
        )
      }
      if (envelope.code !== undefined && envelope.code !== 0) {
        throw new BinanceError('rejected', `binance refused (${envelope.code}): ${envelope.msg ?? 'no reason given'}`, envelope.code)
      }
      if (envelope.data === undefined) {
        throw new BinanceError('unavailable', 'binance answered without data')
      }
      return envelope.data
    }
  }
}

/**
 * The query string, in the order given, encoded once. The same string goes
 * into the signature and onto the wire, which is the whole reason it is built
 * here rather than by the URL class on the way out.
 */
function queryString(query: Query | undefined): string {
  if (!query) return ''
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) params.set(key, String(value))
  }
  const encoded = params.toString()
  return encoded ? `?${encoded}` : ''
}

async function readEnvelope<T>(response: Response): Promise<BinanceEnvelope<T> | null> {
  try {
    const body = (await response.json()) as unknown
    return typeof body === 'object' && body !== null ? (body as BinanceEnvelope<T>) : null
  } catch {
    return null
  }
}

/** "Timestamp outside recv_window. serverTime=2026-09-21T11:42:00.379942745Z" → milliseconds. */
export function serverTimeIn(message: string | undefined): number | null {
  const match = /serverTime=(\S+)/.exec(message ?? '')
  if (!match) return null
  const parsed = Date.parse(match[1]!)
  return Number.isFinite(parsed) ? parsed : null
}

/** Null when there is no header, or the wait is longer than the request is worth. */
function retryWaitMs(response: Response): number | null {
  const raw = response.headers.get('retry-after')
  if (raw === null) return null
  const seconds = Number(raw)
  if (!Number.isFinite(seconds) || seconds < 0) return null
  const ms = Math.max(seconds * 1000, 100)
  return ms > MAX_RETRY_WAIT_MS ? null : ms
}
