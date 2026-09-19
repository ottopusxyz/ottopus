import { type Abi, type Hex, createPublicClient, http } from 'viem'
import { normalize } from 'viem/ens'
import { RpcReadError, rpcUrlFor, viemChainFor } from '../core/index.js'

/**
 * What the decoder asks the outside world. Three questions, each behind an
 * interface so the tests answer them from memory and the real thing answers
 * from an RPC, Sourcify and 4byte.
 */
export interface SourcifyMatch {
  abi: Abi
  name: string | undefined
  match: string
}

export interface Lookups {
  /** Runtime code at an address. "0x" for a wallet. Throws if the chain cannot be read — never guesses. */
  getCode(chainId: string, address: string): Promise<Hex>
  /**
   * An ENS name to its address, read from the registry on Ethereum. Null when
   * the name has no address. Throws if Ethereum cannot be read — a recipient
   * is never guessed.
   */
  resolveName(name: string): Promise<string | null>
  /** Verified source, or null. Null on any failure: unverified is the safe reading. */
  sourcify(chainId: string, address: string): Promise<SourcifyMatch | null>
  /** Text signatures for a selector, most trustworthy first. Empty on failure. */
  fourByte(selector: string): Promise<string[]>
}

export interface HttpLookupOptions {
  rpcUrlTemplate?: string | undefined
  sourcifyUrl?: string
  fourByteUrl?: string
  /** The chain read. Generous: without it nothing can be decoded. */
  rpcTimeoutMs?: number
  /** The two lookups. Short: a slow answer degrades to unverified or unknown, and is retried next time. */
  lookupTimeoutMs?: number
  fetch?: typeof fetch
  now?: () => number
}

const SOURCIFY = 'https://sourcify.dev/server'
const FOUR_BYTE = 'https://www.4byte.directory'

/** How long an answer is trusted. An outage is not an answer and is not kept at all. */
const FOUND_TTL_MS = 60 * 60_000
/** "Not verified" can change — people verify contracts — so it is re-asked sooner. */
const ABSENT_TTL_MS = 10 * 60_000

/**
 * A cache that keeps answers and forgets failures.
 *
 * A Sourcify 503 during a lookup must not pin a contract as unverified until
 * the process restarts; the next plan asks again. Only a definite answer —
 * found, or a definite 404 — is kept, each for as long as it can be trusted.
 */
class Remembered<T> {
  private readonly entries = new Map<string, { value: Promise<T | undefined>; expires: number }>()
  constructor(private readonly now: () => number) {}

  get(key: string, load: () => Promise<{ value: T; ttlMs: number } | undefined>): Promise<T | undefined> {
    const hit = this.entries.get(key)
    if (hit && hit.expires > this.now()) return hit.value
    const value = load().then((result) => {
      if (result === undefined) {
        this.entries.delete(key)
        return undefined
      }
      this.entries.set(key, { value: Promise.resolve(result.value), expires: this.now() + result.ttlMs })
      return result.value
    })
    // Held while in flight so concurrent callers share one request; replaced
    // or evicted the moment the answer is known.
    this.entries.set(key, { value, expires: Number.POSITIVE_INFINITY })
    return value
  }
}

/**
 * The real lookups. Code is never cached: a contract can be deployed to an
 * address that was empty a minute ago.
 */
export function httpLookups(options: HttpLookupOptions = {}): Lookups {
  const doFetch = options.fetch ?? fetch
  const now = options.now ?? Date.now
  const rpcTimeout = options.rpcTimeoutMs ?? 8_000
  const lookupTimeout = options.lookupTimeoutMs ?? 3_000
  const sourcifyUrl = options.sourcifyUrl ?? SOURCIFY
  const fourByteUrl = options.fourByteUrl ?? FOUR_BYTE
  const sourcify = new Remembered<SourcifyMatch | null>(now)
  const fourByte = new Remembered<string[]>(now)

  const evmId = (chainId: string) => chainId.split(':')[1]!

  return {
    async getCode(chainId, address) {
      const client = createPublicClient({
        chain: viemChainFor(chainId),
        transport: http(rpcUrlFor(chainId, options.rpcUrlTemplate), { timeout: rpcTimeout, fetchFn: doFetch }),
      })
      try {
        const code = await client.getCode({ address: address as Hex })
        return code ?? '0x'
      } catch (err) {
        throw new RpcReadError(chainId, err)
      }
    },

    async resolveName(name) {
      const client = createPublicClient({
        chain: viemChainFor('eip155:1'),
        transport: http(rpcUrlFor('eip155:1', options.rpcUrlTemplate), { timeout: rpcTimeout, fetchFn: doFetch }),
      })
      try {
        const address = await client.getEnsAddress({ name: normalize(name) })
        return address ? address.toLowerCase() : null
      } catch (err) {
        throw new RpcReadError('eip155:1', err)
      }
    },

    async sourcify(chainId, address) {
      const key = `${chainId}:${address.toLowerCase()}`
      const answer = await sourcify.get(key, async () => {
        try {
          const res = await doFetch(
            `${sourcifyUrl}/v2/contract/${evmId(chainId)}/${address}?fields=abi,compilation`,
            { signal: AbortSignal.timeout(lookupTimeout) },
          )
          if (res.status === 404) return { value: null, ttlMs: ABSENT_TTL_MS }
          if (!res.ok) return undefined
          const body = (await res.json()) as {
            abi?: Abi
            match?: string
            compilation?: { name?: string }
          }
          if (!Array.isArray(body.abi)) return undefined
          return {
            value: { abi: body.abi, name: body.compilation?.name, match: body.match ?? 'match' },
            ttlMs: FOUND_TTL_MS,
          }
        } catch {
          return undefined
        }
      })
      return answer ?? null
    },

    async fourByte(selector) {
      const answer = await fourByte.get(selector, async () => {
        try {
          // Oldest first: the earliest registration for a selector is the
          // one real contracts use; later ones are mostly collisions.
          const res = await doFetch(
            `${fourByteUrl}/api/v1/signatures/?hex_signature=${selector}&ordering=created_at`,
            { signal: AbortSignal.timeout(lookupTimeout) },
          )
          if (!res.ok) return undefined
          const body = (await res.json()) as { results?: { text_signature: string }[] }
          const signatures = (body.results ?? []).map((r) => r.text_signature)
          // No registration is a definite answer too, and one that can change.
          return { value: signatures, ttlMs: signatures.length ? FOUND_TTL_MS : ABSENT_TTL_MS }
        } catch {
          return undefined
        }
      })
      return answer ?? []
    },
  }
}
