import { zeroAddress } from 'viem'
import {
  EVM_ADDRESS_RE,
  findChain,
  formatAssetId,
  isNativeAsset,
  nativeAssetIdOf,
  parseAssetId,
  parseChainId,
  toEvmChainId,
} from '../../core/index.js'
import type { TokenInfo, TokenRegistry } from './types.js'

/**
 * Token metadata from LI.FI, which is already the route provider.
 *
 * Same host, no key, and a token list it has to maintain anyway to route
 * against. Probed live: a symbol or an address resolves in 220–490 ms and
 * comes back with decimals, a name, a logo and a price.
 *
 * The chain's own currency never leaves this process. The registry answers
 * it from `nativeAssetIdOf` and the chain list, because ETH on Base is not
 * something worth a network call and a provider that called it the wrong
 * thing would be worse than no answer.
 */

export interface LifiTokenOptions {
  apiKey?: string | undefined
  baseUrl?: string
  fetch?: typeof fetch
  timeoutMs?: number
  now?: () => number
  /** How long an answer is kept. Token metadata does not move. */
  ttlMs?: number
  /** How long a miss is kept. Shorter: a token can be listed tomorrow. */
  missTtlMs?: number
}

interface LifiToken {
  address?: string
  chainId?: number
  symbol?: string
  name?: string
  decimals?: number
  logoURI?: string
  priceUSD?: string
  verificationStatus?: string
}

const LIFI_URL = 'https://li.quest'
const DEFAULT_TTL_MS = 24 * 60 * 60_000
const DEFAULT_MISS_TTL_MS = 10 * 60_000

export function lifiTokens(options: LifiTokenOptions = {}): TokenRegistry {
  const doFetch = options.fetch ?? fetch
  const baseUrl = options.baseUrl ?? LIFI_URL
  const timeout = options.timeoutMs ?? 6_000
  const now = options.now ?? Date.now
  const ttl = options.ttlMs ?? DEFAULT_TTL_MS
  const missTtl = options.missTtlMs ?? DEFAULT_MISS_TTL_MS
  const cache = new Map<string, { at: number; info: TokenInfo | null }>()

  const remembered = (key: string): { info: TokenInfo | null } | null => {
    const held = cache.get(key)
    if (!held) return null
    const age = now() - held.at
    if (age > (held.info ? ttl : missTtl)) {
      cache.delete(key)
      return null
    }
    return held
  }

  /** The chain's own currency, from the registry rather than the network. */
  const nativeInfo = (chainId: string): TokenInfo | null => {
    const info = findChain(chainId)
    const assetId = nativeAssetIdOf(chainId)
    if (!info || !assetId) return null
    return {
      assetId,
      symbol: info.nativeCurrency.symbol,
      name: info.nativeCurrency.name,
      decimals: info.nativeCurrency.decimals,
      iconUrl: null,
      priceUsd: null,
      verified: true,
    }
  }

  async function ask(chainId: string, token: string): Promise<TokenInfo | null> {
    const key = `${chainId}|${token.toLowerCase()}`
    const held = remembered(key)
    if (held) return held.info
    let info: TokenInfo | null = null
    try {
      const params = new URLSearchParams({ chain: String(toEvmChainId(chainId)), token })
      const res = await doFetch(`${baseUrl}/v1/token?${params.toString()}`, {
        headers: { accept: 'application/json', ...(options.apiKey ? { 'x-lifi-api-key': options.apiKey } : {}) },
        signal: AbortSignal.timeout(timeout),
      })
      // A token nobody lists is an answer, not a failure. Anything else is a
      // failure and is not cached as a miss.
      if (res.status === 404) {
        cache.set(key, { at: now(), info: null })
        return null
      }
      if (!res.ok) return null
      info = shape(chainId, (await res.json()) as LifiToken)
    } catch {
      // A registry that will not answer costs a name, never a plan.
      return null
    }
    cache.set(key, { at: now(), info })
    return info
  }

  return {
    name: 'lifi',

    async byAssetId(assetId) {
      let parsed: ReturnType<typeof parseAssetId>
      try {
        parsed = parseAssetId(assetId)
      } catch {
        return null
      }
      const chainId = `${parsed.namespace}:${parsed.reference}`
      if (isNativeAsset(assetId)) return nativeInfo(chainId)
      if (parsed.assetNamespace !== 'erc20') return null
      return ask(chainId, parsed.assetReference)
    },

    async find(chainId, query) {
      const trimmed = query.trim()
      if (!trimmed) return null
      try {
        if (parseChainId(chainId).namespace !== 'eip155') return null
      } catch {
        return null
      }
      const native = nativeInfo(chainId)
      // The chain's own currency answered by name, before any lookup: a
      // provider is free to have its own idea of what "ETH" means.
      if (native && trimmed.toUpperCase() === native.symbol.toUpperCase()) return native
      if (EVM_ADDRESS_RE.test(trimmed) && trimmed.toLowerCase() === zeroAddress) return native
      return ask(chainId, trimmed)
    },
  }
}

/** The provider's body as a TokenInfo, or null when it is missing what matters. */
function shape(chainId: string, body: LifiToken): TokenInfo | null {
  const address = body.address
  if (!address || !EVM_ADDRESS_RE.test(address) || typeof body.decimals !== 'number') return null
  // The zero address is how this provider names the chain's own currency.
  if (address.toLowerCase() === zeroAddress) return null
  const price = Number(body.priceUSD ?? '')
  const chain = parseChainId(chainId)
  return {
    assetId: formatAssetId({
      namespace: chain.namespace,
      reference: chain.reference,
      assetNamespace: 'erc20',
      assetReference: address.toLowerCase(),
    }),
    symbol: body.symbol ?? 'units',
    name: body.name ?? body.symbol ?? 'unknown token',
    decimals: body.decimals,
    iconUrl: body.logoURI ?? null,
    priceUsd: Number.isFinite(price) && price > 0 ? price : null,
    verified: body.verificationStatus === 'verified',
  }
}
