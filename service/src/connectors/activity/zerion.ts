/**
 * Zerion's `/wallets/{address}/transactions/`, one page of one account.
 *
 * Everything vendor-shaped stops here: chain slugs become CAIP-2, the
 * `operation_type` enum becomes our kind, `quantity.int` stays a string, and
 * an approval's oddly named `sender` becomes the spender it is.
 *
 * The page bound is `filter[max_mined_at]`, which is documented, exclusive,
 * and in milliseconds — probed on Sep 12: the bound itself is left out, and
 * a value in seconds returns nothing. `mined_at` has second precision, so a
 * bound one second past the instant asked for includes everything mined in
 * that second, and the merge drops what it already has.
 */

import type { ChainMap } from '../portfolio/chains.js'
import { PortfolioError, type AccountRef } from '../portfolio/types.js'
import { ZerionClient, type ZerionClientOptions, type ZerionListResponse } from '../zerion/client.js'
import {
  ACTIVITY_KINDS,
  type Activity,
  type ActivityConnector,
  type ActivityKind,
  type ActivityPageRead,
  type ActivityQuery,
  type ActivityStatus,
  type Approval,
  type Fee,
  type Transfer,
  type TransferAsset,
} from './types.js'

/** Zerion's ceiling for a page. */
const MAX_PAGE_SIZE = 100

/**
 * An allowance at or past Permit2's max uint160 is "spend anything", however
 * the token counts. The largest real supplies sit some fifteen orders of
 * magnitude below it.
 */
const UNLIMITED_FROM = (1n << 160n) - 1n

export interface ZerionActivityOptions extends ZerionClientOptions {
  client?: ZerionClient
}

interface ZerionQuantity {
  int?: string
  decimals?: number
}

interface ZerionFungibleInfo {
  name?: string
  symbol?: string
  icon?: { url?: string | null } | null
  flags?: { verified?: boolean }
}

interface ZerionNftInfo {
  contract_address?: string
  token_id?: string
  name?: string
  content?: { preview?: { url?: string | null } | null; detail?: { url?: string | null } | null } | null
}

interface ZerionTransfer {
  direction?: string
  quantity?: ZerionQuantity
  value?: number | null
  price?: number | null
  sender?: string
  recipient?: string
  fungible_info?: ZerionFungibleInfo
  nft_info?: ZerionNftInfo
}

interface ZerionFee {
  fungible_info?: ZerionFungibleInfo | null
  quantity?: ZerionQuantity
  value?: number | null
}

interface ZerionApproval {
  quantity?: ZerionQuantity
  sender?: string
  fungible_info?: ZerionFungibleInfo
  nft_info?: ZerionNftInfo
}

export interface ZerionTransaction {
  id?: string
  attributes?: {
    operation_type?: string
    hash?: string
    mined_at_block?: number
    mined_at?: string
    sent_from?: string
    sent_to?: string
    status?: string
    fee?: ZerionFee | null
    transfers?: ZerionTransfer[]
    approvals?: ZerionApproval[]
    application_metadata?: {
      name?: string
      icon?: { url?: string | null } | null
      contract_address?: string
      method?: { id?: string; name?: string } | null
    } | null
    flags?: { is_trash?: boolean }
  }
  relationships?: {
    chain?: { data?: { id?: string } }
  }
}

export class ZerionActivityConnector implements ActivityConnector {
  readonly provider = 'zerion'

  private readonly client: ZerionClient

  constructor(options: ZerionActivityOptions) {
    this.client = options.client ?? new ZerionClient(options)
  }

  chainName(chainId: string): string | null {
    return this.client.chainName(chainId)
  }

  chainIcon(chainId: string): string | null {
    return this.client.chainIcon(chainId)
  }

  async transactionsFor(account: AccountRef, query: ActivityQuery): Promise<ActivityPageRead> {
    if (account.namespace !== 'eip155') {
      throw new PortfolioError('unavailable', `zerion connector reads eip155 accounts, not ${account.namespace}`)
    }

    const chains = await this.client.chainMap()

    const params = new URLSearchParams({
      currency: 'usd',
      // Zerion's own spam classification. An airdropped fake is not something
      // the wallet did.
      'filter[trash]': 'only_non_trash',
      'page[size]': String(Math.min(Math.max(1, Math.floor(query.size)), MAX_PAGE_SIZE)),
    })
    if (query.kinds && query.kinds.length > 0) params.set('filter[operation_types]', query.kinds.join(','))
    if (query.chainId) {
      const slug = chains.slugOf(query.chainId)
      // A chain the provider does not know has no history to read.
      if (!slug) return { items: [], more: false, raw: [] }
      params.set('filter[chain_ids]', slug)
    }
    if (query.before) {
      const at = Date.parse(query.before)
      if (!Number.isFinite(at)) throw new PortfolioError('unavailable', 'activity bound is not a date')
      params.set('filter[max_mined_at]', String(at + 1000))
    }

    const body = await this.client.get<ZerionListResponse<ZerionTransaction>>(
      `${this.client.baseUrl}/wallets/${account.address}/transactions/?${params}`,
    )

    const items: Activity[] = []
    const raw: ActivityPageRead['raw'] = []
    for (const row of body.data ?? []) {
      if (row.id && row.attributes?.mined_at) raw.push({ id: row.id, minedAt: row.attributes.mined_at })
      const item = toActivity(row, chains)
      if (item) items.push(item)
    }
    return { items, more: Boolean(body.links?.next), raw }
  }
}

const KINDS = new Set<string>(ACTIVITY_KINDS)

/** A kind we have a word for; anything new reads as a contract call rather than being dropped. */
function kindOf(raw: string | undefined): ActivityKind {
  return raw && KINDS.has(raw) ? (raw as ActivityKind) : 'execute'
}

function statusOf(raw: string | undefined): ActivityStatus {
  return raw === 'failed' || raw === 'pending' ? raw : 'confirmed'
}

function quantityOf(quantity: ZerionQuantity | undefined): { amount: string; decimals: number } | null {
  const amount = quantity?.int
  const decimals = quantity?.decimals
  if (typeof amount !== 'string' || !/^[0-9]+$/.test(amount)) return null
  if (!Number.isInteger(decimals) || decimals! < 0 || decimals! > 36) return null
  return { amount, decimals: decimals! }
}

function assetOf(fungible: ZerionFungibleInfo | undefined, nft: ZerionNftInfo | undefined): TransferAsset | null {
  if (fungible?.symbol) {
    return {
      kind: 'fungible',
      symbol: fungible.symbol,
      name: fungible.name ?? fungible.symbol,
      iconUrl: fungible.icon?.url ?? null,
      verified: fungible.flags?.verified === true,
    }
  }
  if (nft?.contract_address && nft.token_id !== undefined) {
    return {
      kind: 'nft',
      name: nft.name ?? `#${nft.token_id}`,
      imageUrl: nft.content?.preview?.url ?? nft.content?.detail?.url ?? null,
      contract: nft.contract_address,
      tokenId: nft.token_id,
    }
  }
  return null
}

function priced(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function transferOf(raw: ZerionTransfer): Transfer | null {
  const asset = assetOf(raw.fungible_info, raw.nft_info)
  const quantity = quantityOf(raw.quantity)
  if (!asset || !quantity) return null
  const direction = raw.direction === 'in' || raw.direction === 'out' || raw.direction === 'self' ? raw.direction : null
  if (!direction) return null
  return {
    direction,
    asset,
    ...quantity,
    value: priced(raw.value),
    price: priced(raw.price),
    sender: raw.sender ?? '',
    recipient: raw.recipient ?? '',
  }
}

function approvalOf(raw: ZerionApproval): Approval | null {
  const asset = assetOf(raw.fungible_info, raw.nft_info)
  const quantity = quantityOf(raw.quantity)
  if (!asset || !quantity || !raw.sender) return null
  return {
    asset,
    ...quantity,
    unlimited: BigInt(quantity.amount) >= UNLIMITED_FROM,
    // Zerion calls the spender the approval's "sender". It is the contract
    // being allowed to spend, and that is the only reading a row can show.
    spender: raw.sender,
  }
}

function feeOf(raw: ZerionFee | null | undefined): Fee | null {
  const symbol = raw?.fungible_info?.symbol
  const quantity = quantityOf(raw?.quantity)
  if (!symbol || !quantity) return null
  return { symbol, ...quantity, value: priced(raw?.value) }
}

/** Null for anything we cannot name honestly. The caller drops those. */
export function toActivity(raw: ZerionTransaction, chains: ChainMap): Activity | null {
  const attributes = raw.attributes
  if (!raw.id || !attributes?.hash || !attributes.mined_at) return null

  const slug = raw.relationships?.chain?.data?.id
  if (!slug) return null
  // Non-EVM, or a chain the provider listed without a chain id. Every arm we
  // read is eip155, and a row we cannot name in CAIP-2 is a row we cannot link.
  const chainId = chains.caipOf(slug)
  if (!chainId) return null

  const transfers: Transfer[] = []
  for (const transfer of attributes.transfers ?? []) {
    const out = transferOf(transfer)
    if (out) transfers.push(out)
  }
  const approvals: Approval[] = []
  for (const approval of attributes.approvals ?? []) {
    const out = approvalOf(approval)
    if (out) approvals.push(out)
  }

  const app = attributes.application_metadata
  return {
    id: raw.id,
    hash: attributes.hash,
    chainId,
    minedAt: attributes.mined_at,
    block: attributes.mined_at_block ?? 0,
    status: statusOf(attributes.status),
    kind: kindOf(attributes.operation_type),
    from: attributes.sent_from ?? '',
    to: attributes.sent_to ?? '',
    fee: feeOf(attributes.fee),
    transfers,
    approvals,
    app: app?.contract_address
      ? {
          name: app.name || null,
          iconUrl: app.icon?.url ?? null,
          contract: app.contract_address,
          method: app.method?.name || null,
        }
      : null,
  }
}
