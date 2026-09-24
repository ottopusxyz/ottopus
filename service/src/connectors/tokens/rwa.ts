import { EVM_ADDRESS_RE, formatAssetId, parseAssetId, parseChainId, toEvmChainId } from '../../core/index.js'
import { BinanceClient, BinanceError } from '../binance/index.js'
import type { StockInfo, StockRegistry, TokenInfo, TokenRegistry } from './types.js'

/**
 * Tokenized stocks from Binance's RWA data, the one source that knows which
 * contracts *are* a stock.
 *
 * A general token registry cannot be trusted with a stock symbol. Asked for
 * "NVDAB" on BNB Chain, Zerion answers an unrelated leveraged ETF token and
 * lists the real bStock as "N4B", unverified; a bare symbol would have bound
 * a plan to the wrong contract. The RWA search resolves a ticker, a company
 * name, a token symbol or an address to every provider variant with its
 * address in one call, and the token list carries what the search does not:
 * decimals, logo, share ratio, market status and prices.
 *
 * Two endpoints, two habits worth knowing:
 *
 *   - `search` matches loosely — "A" returns twenty-three tickers — and
 *     answers across every chain the vendor lists, whatever chain filter is
 *     sent. Narrowing to the chain asked about, and to an exact symbol or
 *     ticker when the query is one, happens here.
 *   - `tokens` honours only the chain filter. An address filter is accepted
 *     and ignored, and the whole list comes back: a few hundred rows. So the
 *     list is fetched once per chain and every address lookup reads from it.
 *     It answers only for BNB Chain today; asked for Ethereum it is empty,
 *     although the search names Ethereum addresses. A variant the list has
 *     no row for is dropped rather than returned without decimals, and the
 *     general registry answers for that chain instead.
 *
 * Caching follows the Zerion registry: a day on a hit, ten minutes on a
 * miss, never a failure. The token list is the exception, because it is not
 * only identity. Market status and prices are read from it, and a halt is
 * worth knowing about within the minute, so the list is refreshed on a short
 * clock and served stale when the refresh fails. `stock.asOf` says when the
 * facts were read.
 */

export interface RwaTokenOptions {
  /** The signed client, shared with every other Binance connector. */
  client: BinanceClient
  now?: () => number
  /** How long a search answer is kept. Which contracts are a stock does not move. */
  ttlMs?: number
  /** How long a search miss is kept. Shorter: a stock can be listed tomorrow. */
  missTtlMs?: number
  /** How long the token list is kept. Short: status and prices live on it. */
  factsTtlMs?: number
}

/** Answers both questions: what a token is, and which tokens are a stock. */
export type RwaRegistry = TokenRegistry & StockRegistry

export const RWA_REGISTRY = 'binance-rwa'

const DEFAULT_TTL_MS = 24 * 60 * 60_000
const DEFAULT_MISS_TTL_MS = 10 * 60_000
const DEFAULT_FACTS_TTL_MS = 60_000

const SEARCH_PATH = '/api/v1/dex/market/rwa/search'
const TOKENS_PATH = '/api/v1/dex/market/rwa/tokens'

/** The vendor's code for a search that matched nothing. An answer, not a failure. */
const CODE_NO_MATCH = 40382

/** One vendor row on the token list. Numbers arrive as strings. */
interface RwaToken {
  binanceChainId?: string
  tokenContractAddress?: string
  platformId?: string
  tokenName?: string
  tokenSymbol?: string
  tokenLogoUrl?: string | null
  decimals?: string | number
  underlyingTicker?: string
  underlyingName?: string
  tokenToShareRatio?: string | number
  statusInfo?: {
    openState?: boolean
    marketStatus?: string | null
    reasonCode?: string | null
    nextOpenTime?: number | null
    nextCloseTime?: number | null
  } | null
  tokenPrice?: string | number | null
  referencePrice?: string | number | null
}

/** One underlying on the search answer, with its variants across chains. */
interface RwaSearchGroup {
  ticker?: string
  companyName?: string
  assets?: {
    platformId?: string
    binanceChainId?: string
    tokenContractAddress?: string
    tokenSymbol?: string
  }[]
}

/** A provider answered, a provider said no such thing, or a provider failed. */
type Answer<T> = { kind: 'found'; body: T } | { kind: 'absent' } | { kind: 'failed' }

/** The list for one chain: every stock token by lowercased address. */
type Facts = Map<string, StockInfo>

export function rwaTokens(options: RwaTokenOptions): RwaRegistry {
  const { client } = options
  const now = options.now ?? Date.now
  const ttl = options.ttlMs ?? DEFAULT_TTL_MS
  const missTtl = options.missTtlMs ?? DEFAULT_MISS_TTL_MS
  const factsTtl = options.factsTtlMs ?? DEFAULT_FACTS_TTL_MS

  const searches = new Map<string, { at: number; groups: RwaSearchGroup[] | null }>()
  const facts = new Map<string, { at: number; rows: Facts }>()
  /** One request in flight per key, so a burst of lookups is one fetch. */
  const inflight = new Map<string, Promise<unknown>>()

  function once<T>(key: string, run: () => Promise<T>): Promise<T> {
    const running = inflight.get(key) as Promise<T> | undefined
    if (running) return running
    const started = run().finally(() => inflight.delete(key))
    inflight.set(key, started)
    return started
  }

  /**
   * Both endpoints answer with an array. Anything else under a success code
   * is a vendor fault, not an empty answer: caching it as a miss would hide
   * a recovered vendor for ten minutes, and a list that is not a list must
   * not replace the stale rows that are.
   */
  async function get<T>(path: string, query: Record<string, string>): Promise<Answer<T[]>> {
    try {
      const body = await client.get<unknown>(path, query)
      return Array.isArray(body) ? { kind: 'found', body: body as T[] } : { kind: 'failed' }
    } catch (err) {
      if (err instanceof BinanceError && err.vendorCode === CODE_NO_MATCH) return { kind: 'absent' }
      return { kind: 'failed' }
    }
  }

  /**
   * The token list for a chain, fresh within `factsTtl`, or stale when the
   * vendor cannot be reached. Null only when there has never been an answer.
   * An empty list is an answer: the vendor covers no stock on that chain.
   */
  function listFor(chainId: string, binanceChain: string): Promise<Facts | null> {
    const held = facts.get(binanceChain)
    if (held && now() - held.at <= (held.rows.size > 0 ? factsTtl : missTtl)) return Promise.resolve(held.rows)
    return once(`list|${binanceChain}`, async () => {
      const answer = await get<RwaToken>(TOKENS_PATH, { binanceChainId: binanceChain })
      if (answer.kind === 'failed') return held?.rows ?? null
      const asOf = new Date(now()).toISOString()
      const rows: Facts = new Map()
      for (const row of answer.kind === 'found' ? answer.body : []) {
        const info = shape(chainId, row, asOf)
        if (info) rows.set(addressOf(info.assetId), info)
      }
      facts.set(binanceChain, { at: now(), rows })
      return rows
    })
  }

  /** Every underlying the vendor matches to a keyword, on every chain. */
  function search(keyword: string): Promise<Answer<RwaSearchGroup[]>> {
    const key = keyword.toLowerCase()
    const held = searches.get(key)
    if (held) {
      if (now() - held.at <= (held.groups ? ttl : missTtl)) {
        return Promise.resolve(held.groups ? { kind: 'found', body: held.groups } : { kind: 'absent' })
      }
      searches.delete(key)
    }
    return once(`search|${key}`, async () => {
      const answer = await get<RwaSearchGroup>(SEARCH_PATH, { keyword })
      if (answer.kind === 'failed') return answer
      const groups = answer.kind === 'found' ? answer.body : []
      searches.set(key, { at: now(), groups: groups.length > 0 ? groups : null })
      return groups.length > 0 ? { kind: 'found', body: groups } : { kind: 'absent' }
    })
  }

  async function variants(chainId: string, query: string): Promise<StockInfo[] | null> {
    const trimmed = query.trim()
    const binanceChain = binanceChainOf(chainId)
    if (!trimmed || !binanceChain) return []

    if (EVM_ADDRESS_RE.test(trimmed)) {
      const rows = await listFor(chainId, binanceChain)
      if (!rows) return null
      const found = rows.get(trimmed.toLowerCase())
      return found ? [found] : []
    }

    const answer = await search(trimmed)
    if (answer.kind === 'failed') return null
    if (answer.kind === 'absent') return []
    const wanted = narrow(answer.body, trimmed).filter((asset) => asset.binanceChainId === binanceChain)
    if (wanted.length === 0) return []
    const rows = await listFor(chainId, binanceChain)
    if (!rows) return null
    const out: StockInfo[] = []
    for (const asset of wanted) {
      const found = asset.tokenContractAddress ? rows.get(asset.tokenContractAddress.toLowerCase()) : undefined
      if (found && !out.includes(found)) out.push(found)
    }
    return out
  }

  async function byAssetId(assetId: string): Promise<StockInfo | null> {
    let parsed: ReturnType<typeof parseAssetId>
    try {
      parsed = parseAssetId(assetId)
    } catch {
      return null
    }
    if (parsed.assetNamespace !== 'erc20') return null
    const chainId = `${parsed.namespace}:${parsed.reference}`
    const binanceChain = binanceChainOf(chainId)
    if (!binanceChain) return null
    const rows = await listFor(chainId, binanceChain)
    return rows?.get(parsed.assetReference.toLowerCase()) ?? null
  }

  return {
    name: RWA_REGISTRY,
    byAssetId,
    variants,
    /** One token, when the query names exactly one. Several is not an answer here. */
    async find(chainId, query): Promise<TokenInfo | null> {
      const found = await variants(chainId, query)
      return found?.length === 1 ? found[0]! : null
    },
  }
}

/**
 * The search matches loosely, so a query that is exactly a token symbol or
 * exactly a ticker means that one, not everything it resembles. A company
 * name means the companies it begins, word for word: "NVIDIA" is NVIDIA
 * Corporation, "Bank of America" is itself.
 *
 * A fragment means nothing. The composite asks this registry first for every
 * symbol, crypto included, and the vendor matches "OP" or "SOL" to some
 * ticker or name that merely contains the letters. Kept, that would resolve a
 * plain token to a stock contract, or refuse it as an ambiguous stock, and
 * the general registry that knows it would never be asked.
 */
function narrow(groups: RwaSearchGroup[], query: string): NonNullable<RwaSearchGroup['assets']> {
  const upper = query.toUpperCase()
  const all = groups.flatMap((group) => group.assets ?? [])
  const bySymbol = all.filter((asset) => asset.tokenSymbol?.toUpperCase() === upper)
  if (bySymbol.length > 0) return bySymbol
  const byTicker = groups.filter((group) => group.ticker?.toUpperCase() === upper).flatMap((group) => group.assets ?? [])
  if (byTicker.length > 0) return byTicker
  return groups.filter((group) => namesCompany(group.companyName, upper)).flatMap((group) => group.assets ?? [])
}

/** Whether a query is the company's name, or its leading words: "NVIDIA" for "NVIDIA Corporation", never "NVID". */
function namesCompany(companyName: string | undefined, upperQuery: string): boolean {
  const name = companyName?.trim().toUpperCase()
  if (!name || !name.startsWith(upperQuery)) return false
  const next = name.charAt(upperQuery.length)
  return next === '' || !/[\p{L}\p{N}]/u.test(next)
}

/** The vendor's chain id for an EVM chain: the numeric reference as a string. Null for anything else. */
function binanceChainOf(chainId: string): string | null {
  try {
    if (parseChainId(chainId).namespace !== 'eip155') return null
    return String(toEvmChainId(chainId))
  } catch {
    return null
  }
}

const addressOf = (assetId: string): string => assetId.slice(assetId.lastIndexOf(':') + 1)

/** A positive finite number out of a string, or null: the vendor writes every figure as a string. */
function positive(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? n : null
}

const isoOf = (ms: number | null | undefined): string | null =>
  typeof ms === 'number' && Number.isFinite(ms) && ms > 0 ? new Date(ms).toISOString() : null

/** A vendor row as a StockInfo, or null when it lacks what a plan needs. */
function shape(chainId: string, row: RwaToken, asOf: string): StockInfo | null {
  const address = row.tokenContractAddress?.toLowerCase()
  const decimals = row.decimals === undefined ? NaN : Number(row.decimals)
  const symbol = row.tokenSymbol?.trim()
  const ticker = row.underlyingTicker?.trim()
  const platformId = row.platformId?.trim()
  if (!address || !EVM_ADDRESS_RE.test(address) || !Number.isInteger(decimals) || decimals < 0) return null
  if (!symbol || !ticker || !platformId) return null
  const chain = parseChainId(chainId)
  const status = row.statusInfo ?? null
  return {
    assetId: formatAssetId({
      namespace: chain.namespace,
      reference: chain.reference,
      assetNamespace: 'erc20',
      assetReference: address,
    }),
    symbol,
    name: row.tokenName?.trim() || symbol,
    decimals,
    iconUrl: row.tokenLogoUrl || null,
    priceUsd: positive(row.tokenPrice),
    // A curated list of stock tokens is a listing claim by the vendor, which
    // is exactly what this flag means and all it means.
    verified: true,
    stock: {
      platformId,
      ticker,
      companyName: row.underlyingName?.trim() || ticker,
      tokenToShareRatio: positive(row.tokenToShareRatio) ?? 1,
      referencePriceUsd: positive(row.referencePrice),
      status: {
        open: status?.openState === true,
        marketStatus: status?.marketStatus ?? null,
        reason: status?.reasonCode ?? null,
        nextOpenAt: isoOf(status?.nextOpenTime),
        nextCloseAt: isoOf(status?.nextCloseTime),
      },
      asOf,
    },
  }
}
