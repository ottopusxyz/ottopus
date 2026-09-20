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
 * The HTTP itself — auth, retries, the chain list — is the shared client.
 */

import { CaipError, formatAssetId, nativeAssetOf } from '../../core/index.js'
import { ZerionClient, type ZerionClientOptions, type ZerionListResponse } from '../zerion/client.js'
import type { ChainMap } from './chains.js'
import {
  PortfolioError,
  POSITION_TYPES,
  PROTOCOL_MODULES,
  type AccountPosition,
  type AccountRef,
  type PortfolioConnector,
  type PositionType,
  type ProtocolModule,
} from './types.js'

/**
 * Zerion documents the positions endpoint as unpaginated, and the follow is
 * insurance rather than trust. The cap is what stops a `links.next` that points
 * at itself from becoming an infinite loop inside a request.
 */
const MAX_PAGES = 5

export interface ZerionOptions extends ZerionClientOptions {
  /** A client to share with the other Zerion connectors. Built from the options when absent. */
  client?: ZerionClient
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
    name?: string | null
    quantity?: ZerionQuantity
    value?: number | null
    price?: number | null
    changes?: { absolute_1d?: number | null } | null
    position_type?: string | null
    protocol?: string | null
    protocol_module?: string | null
    pool_address?: string | null
    parent?: string | null
    group_id?: string | null
    fungible_info?: ZerionFungibleInfo
    flags?: { displayable?: boolean }
    application_metadata?: {
      name?: string
      icon?: { url?: string | null } | null
      url?: string | null
    }
  }
  relationships?: {
    fungible?: { data?: { id?: string } }
    chain?: { data?: { id?: string } }
    dapp?: { data?: { id?: string } }
  }
}

export class ZerionPortfolioConnector implements PortfolioConnector {
  readonly provider = 'zerion'

  private readonly client: ZerionClient

  chainName(chainId: string): string | null {
    return this.client.chainName(chainId)
  }

  chainIcon(chainId: string): string | null {
    return this.client.chainIcon(chainId)
  }

  constructor(options: ZerionOptions) {
    this.client = options.client ?? new ZerionClient(options)
  }

  async positionsFor(account: AccountRef): Promise<AccountPosition[]> {
    if (account.namespace !== 'eip155') {
      throw new PortfolioError(
        'unavailable',
        `zerion connector reads eip155 accounts, not ${account.namespace}`,
      )
    }

    const chains = await this.client.chainMap()

    const query = new URLSearchParams({
      currency: 'usd',
      // Everything, DeFi included. A staked balance is real money and the
      // header total has to include it — `positionType` is what keeps it out of
      // the token list. Note Zerion prices enterprise usage differently per
      // filter value.
      'filter[positions]': 'no_filter',
      // Zerion's own spam classification. Airdropped fakes named USDC would
      // otherwise land in a total someone reads as their net worth.
      'filter[trash]': 'only_non_trash',
      sort: '-value',
    })

    const raw: ZerionPosition[] = []
    let url = `${this.client.baseUrl}/wallets/${account.address}/positions/?${query}`

    for (let page = 0; page < MAX_PAGES; page++) {
      const body = await this.client.get<ZerionListResponse<ZerionPosition>>(url)
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
}

const KNOWN_TYPES = new Set<string>(POSITION_TYPES)
const KNOWN_MODULES = new Set<string>(PROTOCOL_MODULES)

/**
 * Zerion's `position_type` is nullable. Falling back is safe in one direction
 * only: calling a protocol position `wallet` would put it in the token list,
 * and the scorer would recommend an arm that cannot actually pay. A position
 * with no protocol behind it genuinely is a loose balance; anything with a
 * protocol is treated as deposited until Zerion says otherwise.
 */
function positionTypeOf(raw: string | null | undefined, protocol: string | null): PositionType {
  if (raw && KNOWN_TYPES.has(raw)) return raw as PositionType
  return protocol === null ? 'wallet' : 'deposit'
}

/** A module we have a word for, or nothing — a new module is not a reason to drop the position. */
function moduleOf(raw: string | null | undefined): ProtocolModule | null {
  return raw && KNOWN_MODULES.has(raw) ? (raw as ProtocolModule) : null
}

/** Something a `dapp` relationship would say, for a protocol Zerion named but did not slug. */
function slugOf(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
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

  const app = attributes.application_metadata
  const protocol = attributes.protocol ?? app?.name ?? null
  const positionType = positionTypeOf(attributes.position_type, protocol)
  const inProtocol = positionType !== 'wallet' || protocol !== null

  // Magnitudes. A loan's value is what is owed, and Zerion has written it both
  // ways over time; `positionType` carries the sign from here, in one place,
  // so a total never counts borrowings as net worth whichever way it arrives.
  const magnitude = (value: number | null | undefined): number | null =>
    typeof value === 'number' && Number.isFinite(value) ? Math.abs(value) : null
  const change = (value: number | null | undefined): number | null =>
    typeof value === 'number' && Number.isFinite(value) ? value : null

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
    value: magnitude(attributes.value),
    price:
      typeof attributes.price === 'number' && Number.isFinite(attributes.price)
        ? attributes.price
        : null,
    change1d: change(attributes.changes?.absolute_1d),
    protocol,
    protocolModule: inProtocol ? moduleOf(attributes.protocol_module) : null,
    positionName: inProtocol ? (attributes.name ?? null) : null,
    dappId: inProtocol ? (item.relationships?.dapp?.data?.id ?? (protocol ? slugOf(protocol) : null)) : null,
    dappIconUrl: inProtocol ? (app?.icon?.url ?? null) : null,
    dappUrl: inProtocol ? (app?.url ?? null) : null,
    poolAddress: attributes.pool_address ?? null,
    parentId: attributes.parent ?? null,
    groupId: attributes.group_id ?? null,
  }
}
