import { zeroAddress } from 'viem'
import {
  EVM_ADDRESS_RE,
  findChain,
  formatAssetId,
  isNativeAsset,
  nativeAssetIdOf,
  parseAssetId,
  parseChainId,
} from '../../core/index.js'
import { ChainMap, type ChainEntry } from '../portfolio/chains.js'
import type { TokenInfo, TokenRegistry } from './types.js'

/**
 * Token metadata from Zerion, which is already the portfolio provider.
 *
 * The same source as the balances, and that is the whole reason. Icons on the
 * review page are looked up by asset id, so with a different provider for the
 * unheld side the same token could render with two different logos on one
 * page depending on whether the person happened to hold it. One source, one
 * logo, one price basis.
 *
 * Zerion also has real search: `filter[search_query]` ranked by market cap,
 * which is what "find me DEGEN" needs and what an exact-match token endpoint
 * cannot do. Ask any provider for "USDC" and the clones come back too;
 * ordering by market cap is the cheapest defence, and the tool shows the
 * address it resolved to so a person can see which one was meant.
 *
 * The chain's own currency never leaves this process. ETH on Base comes from
 * our own chain registry, because it is not worth a round trip and a provider
 * with its own idea of what ETH means would be worse than no answer.
 */

export interface ZerionTokenOptions {
  apiKey: string
  baseUrl?: string
  fetch?: typeof fetch
  timeoutMs?: number
  now?: () => number
  /** How long an answer is kept. Token metadata does not move. */
  ttlMs?: number
  /** How long a miss is kept. Shorter: a token can be listed tomorrow. */
  missTtlMs?: number
  testnet?: boolean
}

const DEFAULT_BASE_URL = 'https://api.zerion.io/v1'
const DEFAULT_TTL_MS = 24 * 60 * 60_000
const DEFAULT_MISS_TTL_MS = 10 * 60_000

/** A provider answered, a provider said no such thing, or a provider failed. */
type Answer<T> = { kind: 'found'; body: T } | { kind: 'absent' } | { kind: 'failed' }

interface Implementation {
  chain_id?: string
  /** Empty string for the chain's own currency on these endpoints. */
  address?: string | null
  decimals?: number
}

interface Fungible {
  id?: string
  attributes?: {
    name?: string
    symbol?: string
    flags?: { verified?: boolean }
    implementations?: Implementation[]
    market_data?: { price?: number | null }
    icon?: { url?: string | null }
  }
}

export function zerionTokens(options: ZerionTokenOptions): TokenRegistry {
  const doFetch = options.fetch ?? fetch
  const baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, '')
  const timeout = options.timeoutMs ?? 6_000
  const now = options.now ?? Date.now
  const ttl = options.ttlMs ?? DEFAULT_TTL_MS
  const missTtl = options.missTtlMs ?? DEFAULT_MISS_TTL_MS
  // Basic auth with the key as the username and an empty password, the same
  // way the portfolio connector does it.
  const authorization = `Basic ${Buffer.from(`${options.apiKey}:`).toString('base64')}`
  const cache = new Map<string, { at: number; info: TokenInfo | null }>()
  let chains: Promise<ChainMap> | null = null

  const remembered = (key: string): { info: TokenInfo | null } | null => {
    const held = cache.get(key)
    if (!held) return null
    if (now() - held.at > (held.info ? ttl : missTtl)) {
      cache.delete(key)
      return null
    }
    return held
  }

  /**
   * Three outcomes, not two.
   *
   * "No such token" and "the provider is having a bad minute" both used to
   * come back as null, so the caller cached a provider outage as an absence —
   * or, as the test caught, cached neither and re-asked on every lookup.
   * Absence is stable and worth remembering; a failure is neither.
   */
  async function get<T>(path: string): Promise<Answer<T>> {
    try {
      const headers: Record<string, string> = { authorization, accept: 'application/json' }
      if (options.testnet) headers['X-Env'] = 'testnet'
      const res = await doFetch(`${baseUrl}${path}`, { headers, signal: AbortSignal.timeout(timeout) })
      if (res.status === 404) return { kind: 'absent' }
      if (!res.ok) return { kind: 'failed' }
      return { kind: 'found', body: (await res.json()) as T }
    } catch {
      return { kind: 'failed' }
    }
  }

  /**
   * Zerion's chain slugs, fetched once. Hardcoding them turns a chain the
   * provider adds into a token we cannot look up.
   */
  async function chainMap(): Promise<ChainMap | null> {
    chains ??= (async () => {
      const answer = await get<{
        data?: { id?: string; attributes?: { name?: string; external_id?: string; icon?: { url?: string | null } } }[]
      }>('/chains/')
      const body = answer.kind === 'found' ? answer.body : null
      const entries: ChainEntry[] = (body?.data ?? [])
        .filter((item): item is { id: string; attributes?: Record<string, never> } => Boolean(item.id))
        .map((item) => ({
          id: item.id,
          name: (item.attributes as { name?: string } | undefined)?.name ?? item.id,
          externalId: (item.attributes as { external_id?: string } | undefined)?.external_id,
          iconUrl: null,
        }))
      if (entries.length === 0) throw new Error('empty chain list')
      return new ChainMap(entries)
    })().catch(() => {
      // Let the next caller try again rather than caching the failure.
      chains = null
      throw new Error('no chain list')
    })
    return chains.catch(() => null)
  }

  /** The chain's own currency, from our registry rather than the network. */
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

  async function slugFor(chainId: string): Promise<string | null> {
    return (await chainMap())?.slugOf(chainId) ?? null
  }

  /** One token by chain and contract address. */
  async function byImplementation(chainId: string, address: string): Promise<TokenInfo | null> {
    const key = `impl|${chainId}|${address.toLowerCase()}`
    const held = remembered(key)
    if (held) return held.info
    const slug = await slugFor(chainId)
    if (!slug) return null
    const answer = await get<{ data?: Fungible }>(
      `/fungibles/by-implementation?implementation=${encodeURIComponent(`${slug}:${address}`)}`,
    )
    if (answer.kind === 'failed') return null
    const info = answer.kind === 'absent' ? null : shape(chainId, slug, answer.body.data)
    cache.set(key, { at: now(), info })
    return info
  }

  return {
    name: 'zerion',

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
      return byImplementation(chainId, parsed.assetReference)
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
      // The chain's own currency by name, before any lookup.
      if (native && trimmed.toUpperCase() === native.symbol.toUpperCase()) return native
      if (EVM_ADDRESS_RE.test(trimmed)) {
        if (trimmed.toLowerCase() === zeroAddress) return native
        return byImplementation(chainId, trimmed)
      }

      const key = `find|${chainId}|${trimmed.toLowerCase()}`
      const held = remembered(key)
      if (held) return held.info
      const slug = await slugFor(chainId)
      if (!slug) return null
      const params = new URLSearchParams({
        'filter[search_query]': trimmed,
        'filter[implementation_chain_id]': slug,
        // Biggest first. A symbol matches its own clones, and market cap is
        // the cheapest way to put the real one on top; the tool shows the
        // address it landed on so a person can still check.
        sort: '-market_data.market_cap',
        'page[size]': '1',
      })
      const answer = await get<{ data?: Fungible[] }>(`/fungibles/?${params.toString()}`)
      if (answer.kind === 'failed') return null
      const info = answer.kind === 'absent' ? null : shape(chainId, slug, answer.body.data?.[0])
      cache.set(key, { at: now(), info })
      return info
    },
  }
}

/**
 * A fungible as a TokenInfo, for one chain.
 *
 * A fungible spans chains, so the implementation for the chain being asked
 * about is the only one that carries a usable address and decimals. Zerion
 * writes the native implementation's address as an empty string here — and as
 * null on the wallet endpoints — and native is answered locally, so an
 * addressless implementation is dropped rather than guessed at.
 */
function shape(chainId: string, slug: string, fungible: Fungible | undefined): TokenInfo | null {
  const attributes = fungible?.attributes
  if (!attributes) return null
  const mine = (attributes.implementations ?? []).find((i) => i.chain_id === slug)
  const address = mine?.address
  if (!address || !EVM_ADDRESS_RE.test(address) || typeof mine?.decimals !== 'number') return null
  const price = attributes.market_data?.price
  const chain = parseChainId(chainId)
  return {
    assetId: formatAssetId({
      namespace: chain.namespace,
      reference: chain.reference,
      assetNamespace: 'erc20',
      assetReference: address.toLowerCase(),
    }),
    symbol: attributes.symbol ?? 'units',
    name: attributes.name ?? attributes.symbol ?? 'unknown token',
    decimals: mine.decimals,
    iconUrl: attributes.icon?.url ?? null,
    priceUsd: typeof price === 'number' && price > 0 ? price : null,
    verified: attributes.flags?.verified === true,
  }
}
