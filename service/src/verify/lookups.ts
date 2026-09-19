import { type Abi, type Hex, createPublicClient, http } from 'viem'
import { rpcUrlFor, viemChainFor } from '../core/index.js'

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
  /** Verified source, or null. Null on any failure: unverified is the safe reading. */
  sourcify(chainId: string, address: string): Promise<SourcifyMatch | null>
  /** Text signatures for a selector, most trustworthy first. Empty on failure. */
  fourByte(selector: string): Promise<string[]>
}

export interface HttpLookupOptions {
  rpcUrlTemplate?: string | undefined
  sourcifyUrl?: string
  fourByteUrl?: string
  timeoutMs?: number
  fetch?: typeof fetch
}

const SOURCIFY = 'https://sourcify.dev/server'
const FOUR_BYTE = 'https://www.4byte.directory'

/**
 * The real lookups. Sourcify and 4byte answers are cached for the process —
 * a contract does not become unverified between two calls, and 4byte's answer
 * for a selector never changes. Code is not cached: a contract can be
 * deployed to an address that was empty a minute ago.
 */
export function httpLookups(options: HttpLookupOptions = {}): Lookups {
  const doFetch = options.fetch ?? fetch
  const timeout = options.timeoutMs ?? 8_000
  const sourcifyUrl = options.sourcifyUrl ?? SOURCIFY
  const fourByteUrl = options.fourByteUrl ?? FOUR_BYTE
  const sourcifyCache = new Map<string, Promise<SourcifyMatch | null>>()
  const fourByteCache = new Map<string, Promise<string[]>>()

  const evmId = (chainId: string) => chainId.split(':')[1]!

  return {
    async getCode(chainId, address) {
      const client = createPublicClient({
        chain: viemChainFor(chainId),
        transport: http(rpcUrlFor(chainId, options.rpcUrlTemplate), { timeout }),
      })
      const code = await client.getCode({ address: address as Hex })
      return code ?? '0x'
    },

    sourcify(chainId, address) {
      const key = `${chainId}:${address.toLowerCase()}`
      let hit = sourcifyCache.get(key)
      if (!hit) {
        hit = (async () => {
          try {
            const res = await doFetch(
              `${sourcifyUrl}/v2/contract/${evmId(chainId)}/${address}?fields=abi,compilation`,
              { signal: AbortSignal.timeout(timeout) },
            )
            if (!res.ok) return null
            const body = (await res.json()) as {
              abi?: Abi
              match?: string
              compilation?: { name?: string }
            }
            if (!Array.isArray(body.abi)) return null
            return { abi: body.abi, name: body.compilation?.name, match: body.match ?? 'match' }
          } catch {
            return null
          }
        })()
        sourcifyCache.set(key, hit)
      }
      return hit
    },

    fourByte(selector) {
      let hit = fourByteCache.get(selector)
      if (!hit) {
        hit = (async () => {
          try {
            // Oldest first: the earliest registration for a selector is the
            // one real contracts use; later ones are mostly collisions.
            const res = await doFetch(
              `${fourByteUrl}/api/v1/signatures/?hex_signature=${selector}&ordering=created_at`,
              { signal: AbortSignal.timeout(timeout) },
            )
            if (!res.ok) return []
            const body = (await res.json()) as { results?: { text_signature: string }[] }
            return (body.results ?? []).map((r) => r.text_signature)
          } catch {
            return []
          }
        })()
        fourByteCache.set(selector, hit)
      }
      return hit
    },
  }
}
