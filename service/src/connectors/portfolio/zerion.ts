/**
 * Zerion, the primary portfolio provider (decision ledger, Sep 3).
 *
 * One call per account. Zerion's `/v1/wallet-sets/*` endpoints look built for
 * an eight-arm portfolio and are not: a wallet set may hold **at most one
 * address per chain type**, so it means "this person's EVM address and their
 * Solana address", never eight EOAs. Aggregation is ours, in `aggregate.ts`.
 *
 * Everything vendor-shaped stops at this file. Chain slugs become CAIP-2,
 * fungibles become CAIP-19, `quantity.int` stays a string all the way through.
 */

import { CaipError, formatAssetId, nativeAssetOf } from '../../core/index.js'
import { ChainMap, type ChainEntry } from './chains.js'
import {
  PortfolioError,
  POSITION_TYPES,
  type AccountPosition,
  type AccountRef,
  type PortfolioConnector,
  type PositionType,
} from './types.js'

const DEFAULT_BASE_URL = 'https://api.zerion.io/v1'

/** A page load waits on this. Long enough for a cold wallet, short enough to fail. */
const DEFAULT_TIMEOUT_MS = 10_000

/**
 * Zerion documents the positions endpoint as unpaginated, and the follow is
 * insurance rather than trust. The cap is what stops a `links.next` that points
 * at itself from becoming an infinite loop inside a request.
 */
const MAX_PAGES = 5

/** Retrying inside a request is only worth it when the wait is shorter than the request. */
const MAX_RETRY_WAIT_MS = 2_000
const MAX_ATTEMPTS = 3

export interface ZerionOptions {
  apiKey: string
  baseUrl?: string
  timeoutMs?: number
  /** Injectable for tests. Defaults to the global. */
  fetch?: typeof globalThis.fetch
  /** Testnet data lives in a separate environment behind this header. */
  testnet?: boolean
}

interface ZerionQuantity {
  int?: string
  decimals?: number
}

interface ZerionImplementation {
  chain_id?: string
  address?: string | null
  decimals?: number
}

interface ZerionFungibleInfo {
  id?: string
  name?: string
  symbol?: string
  icon?: { url?: string | null } | null
  flags?: { verified?: boolean }
  implementations?: ZerionImplementation[]
}

interface ZerionPosition {
  attributes?: {
    quantity?: ZerionQuantity
    value?: number | null
    price?: number | null
    changes?: { absolute_1d?: number | null } | null
    position_type?: string | null
    protocol?: string | null
    group_id?: string | null
    fungible_info?: ZerionFungibleInfo
    flags?: { displayable?: boolean }
    application_metadata?: { name?: string }
  }
  relationships?: {
    fungible?: { data?: { id?: string } }
    chain?: { data?: { id?: string } }
  }
}

interface ZerionListResponse<T> {
  data?: T[]
  links?: { next?: string | null }
}

export class ZerionPortfolioConnector implements PortfolioConnector {
  readonly provider = 'zerion'

  private readonly baseUrl: string
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

  chainName(chainId: string): string | null {
    return this.loadedChains?.nameOf(chainId) ?? null
  }

  chainIcon(chainId: string): string | null {
    return this.loadedChains?.iconOf(chainId) ?? null
  }

  constructor(options: ZerionOptions) {
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

  async positionsFor(account: AccountRef): Promise<AccountPosition[]> {
    if (account.namespace !== 'eip155') {
      throw new PortfolioError(
        'unavailable',
        `zerion connector reads eip155 accounts, not ${account.namespace}`,
      )
    }

    const chains = await this.chainMap()

    const query = new URLSearchParams({
      currency: 'usd',
      // Everything, DeFi included. A staked balance is real money and the
      // header total has to include it — `positionType` is what keeps it out of
      // the spendable set. Note Zerion prices enterprise usage differently per
      // filter value.
      'filter[positions]': 'no_filter',
      // Zerion's own spam classification. Airdropped fakes named USDC would
      // otherwise land in a total someone reads as their net worth.
      'filter[trash]': 'only_non_trash',
      sort: '-value',
    })

    const raw: ZerionPosition[] = []
    let url = `${this.baseUrl}/wallets/${account.address}/positions/?${query}`

    for (let page = 0; page < MAX_PAGES; page++) {
      const body = await this.get<ZerionListResponse<ZerionPosition>>(url)
      raw.push(...(body.data ?? []))
      const next = body.links?.next
      if (!next || next === url) break
      if (page === MAX_PAGES - 1) throw new PortfolioError('unavailable', 'zerion returned more positions than the page limit')
      url = next
    }

    const positions: AccountPosition[] = []
    for (const item of raw) {
      const position = toPosition(item, chains)
      if (position) positions.push(position)
    }
    return positions
  }

  private chainMap(): Promise<ChainMap> {
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

  private async get<T>(url: string): Promise<T> {
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
        if (attempt === MAX_ATTEMPTS) break
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

const KNOWN_TYPES = new Set<string>(POSITION_TYPES)

/**
 * Zerion's `position_type` is nullable. Falling back is safe in one direction
 * only: calling a protocol position `wallet` would make it spendable, and the
 * scorer would recommend an arm that cannot actually pay. A position with no
 * protocol behind it genuinely is a loose balance; anything with a protocol is
 * treated as deposited until Zerion says otherwise.
 */
function positionTypeOf(raw: string | null | undefined, protocol: string | null): PositionType {
  if (raw && KNOWN_TYPES.has(raw)) return raw as PositionType
  return protocol === null ? 'wallet' : 'deposit'
}

/**
 * The CAIP-19 for the fungible as held on this chain.
 *
 * A native coin has no contract: Zerion writes `""` for it on the fungibles
 * endpoints and `null` on the wallet endpoints, so both mean slip44.
 */
function assetIdOf(
  fungible: ZerionFungibleInfo,
  slug: string,
  chainId: string,
): string | null {
  const implementation = fungible.implementations?.find((i) => i.chain_id === slug)
  if (!implementation) return null

  const address = implementation.address
  try {
    if (address === null || address === undefined || address === '') {
      return nativeAssetOf(chainId)
    }
    const [namespace, reference] = chainId.split(':')
    return formatAssetId({
      namespace: namespace!,
      reference: reference!,
      assetNamespace: 'erc20',
      assetReference: address,
    })
  } catch (err) {
    // An unnameable asset is dropped rather than guessed at — a chain missing
    // from the SLIP-44 table, or an address that is not 20 bytes.
    if (err instanceof CaipError) return null
    throw err
  }
}

/** Null for anything we cannot name honestly. The caller drops those. */
export function toPosition(item: ZerionPosition, chains: ChainMap): AccountPosition | null {
  const attributes = item.attributes
  if (!attributes) return null

  // Zerion's own answer to "should this count towards the wallet's value".
  if (attributes.flags?.displayable === false) return null

  const slug = item.relationships?.chain?.data?.id
  if (!slug) return null

  const chainId = chains.caipOf(slug)
  // Non-EVM, or a chain the provider listed without a chain id. Either way we
  // cannot name it in CAIP-2, and every arm we read is eip155 anyway.
  if (!chainId) return null

  const fungible = attributes.fungible_info
  if (!fungible) return null

  const assetId = assetIdOf(fungible, slug, chainId)
  if (!assetId) return null

  const amount = attributes.quantity?.int
  const decimals = attributes.quantity?.decimals
  if (typeof amount !== 'string' || !/^[0-9]+$/.test(amount)) return null
  if (!Number.isInteger(decimals) || decimals! < 0 || decimals! > 36) return null

  const protocol = attributes.protocol ?? attributes.application_metadata?.name ?? null
  const positionType = positionTypeOf(attributes.position_type, protocol)

  // A loan is debt. Zerion reports `borrowed` as its own positive figure on the
  // portfolio endpoint, so the sign here is not something to rely on — forcing
  // it negative is right whichever way the provider writes it, and the failure
  // it prevents is a total that counts borrowings as net worth.
  const sign = positionType === 'loan' ? -1 : 1
  const signed = (value: number | null | undefined): number | null =>
    typeof value === 'number' && Number.isFinite(value) ? sign * Math.abs(value) : null
  const change = (value: number | null | undefined): number | null =>
    typeof value === 'number' && Number.isFinite(value) ? sign * value : null

  return {
    assetId,
    chainId,
    asset: {
      familyId: (() => {
        const id = item.relationships?.fungible?.data?.id ?? fungible.id
        return id ? `zerion:${id}` : null
      })(),
      symbol: fungible.symbol ?? '',
      name: fungible.name ?? fungible.symbol ?? '',
      decimals: decimals!,
      iconUrl: fungible.icon?.url ?? null,
      verified: fungible.flags?.verified === true,
    },
    positionType,
    amount,
    value: signed(attributes.value),
    price:
      typeof attributes.price === 'number' && Number.isFinite(attributes.price)
        ? attributes.price
        : null,
    change1d: change(attributes.changes?.absolute_1d),
    protocol,
    groupId: attributes.group_id ?? null,
  }
}
