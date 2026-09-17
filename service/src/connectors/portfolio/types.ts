/**
 * What a portfolio provider has to answer, and nothing about who answers it.
 *
 * Swapping Zerion for the Graph Token API (#30) must not change a single line
 * above this boundary, so nothing here carries a vendor's vocabulary: chains
 * and assets are CAIP, amounts are base units, and the position types are the
 * set every portfolio provider converges on rather than any one provider's
 * enum.
 *
 * The interface is one method on purpose. A connector reads one account; the
 * fan-out across arms, the merging, and the failure accounting all live in
 * `aggregate.ts`, so a second implementation has one small thing to get right.
 */

/**
 * An account, without a chain.
 *
 * Deliberately not CAIP-10: that names an account *on a chain*, and one EOA is
 * the same account on every EVM chain — the same reason `linked_wallets` stores
 * a namespace and an address rather than an identifier per chain. A connector
 * reads every chain at once, so asking it for `eip155:8453:0x…` would imply a
 * call per chain that no provider here actually makes.
 */
export interface AccountRef {
  namespace: string
  /** Lowercased for eip155. Checksum casing is a display concern. */
  address: string
}

/**
 * How an asset is being held.
 *
 * `wallet` is the only one a plan can spend, which is why this survives all the
 * way to the API response — the scorer's eligibility filter will need it, and a
 * staked balance counted as available would recommend a wallet that cannot
 * actually pay.
 */
export type PositionType =
  | 'wallet'
  | 'deposit'
  | 'loan'
  | 'locked'
  | 'staked'
  | 'reward'
  | 'investment'

export const POSITION_TYPES: readonly PositionType[] = [
  'wallet',
  'deposit',
  'loan',
  'locked',
  'staked',
  'reward',
  'investment',
]

/** A plan can only spend what is sitting in the wallet itself. */
export function isSpendable(positionType: PositionType): boolean {
  return positionType === 'wallet'
}

export interface AssetInfo {
  symbol: string
  name: string
  decimals: number
  iconUrl: string | null
  /** The provider vouches for this token's identity. Shown, never trusted. */
  verified: boolean
}

/** One position held by one account, as the connector reports it. */
export interface AccountPosition {
  /** CAIP-19, e.g. eip155:8453/erc20:0x8335… or eip155:8453/slip44:60. */
  assetId: string
  /** CAIP-2. Derivable from assetId, kept because every caller groups by it. */
  chainId: string
  asset: AssetInfo
  positionType: PositionType
  /**
   * Base units, integer string. Never a float: 10^18 exceeds
   * Number.MAX_SAFE_INTEGER, and a rounded balance is one a plan would sign.
   */
  amount: string
  /**
   * Fiat value, **signed** — a loan is negative, because it is debt and a
   * portfolio total that adds borrowings to net worth is not a portfolio total.
   * Null when the provider has no price, which is different from zero.
   */
  value: number | null
  /** Unit price in the requested currency. */
  price: number | null
  /** 24h change in fiat, signed the same way as `value`. */
  change1d: number | null
  /** Protocol name for a DeFi position; null for a plain wallet balance. */
  protocol: string | null
  /**
   * Positions sharing this belong to one pool — a Uniswap v2 USDC/WETH pair
   * arrives as two positions with one group_id. Kept so a UI can put them back
   * together; the token table deliberately does not, because you do hold that
   * much USDC, just not loosely.
   */
  groupId: string | null
}

export type PortfolioErrorCode =
  /** The provider does not track this address — a token contract, a hot wallet. */
  | 'untracked_address'
  /** Out of quota. Retrying inside one request will not help. */
  | 'rate_limited'
  /** Reachable but not answering, or answering something we cannot parse. */
  | 'unavailable'
  /** No API key. A deployment problem, not the person's. */
  | 'not_configured'

export class PortfolioError extends Error {
  constructor(
    readonly code: PortfolioErrorCode,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options)
    this.name = 'PortfolioError'
  }
}

export interface PortfolioConnector {
  /** Named in the response so a reader knows whose numbers these are. */
  readonly provider: string
  /**
   * Every position this account holds, on every chain the provider tracks.
   *
   * Throws `PortfolioError` and nothing else — the caller reads one arm out of
   * eight and has to tell "this address is untracked" apart from "the vendor is
   * down" without pattern-matching on prose.
   */
  positionsFor(account: AccountRef): Promise<AccountPosition[]>
  /**
   * Human name for a chain — "BNB Chain", never "binance-smart-chain".
   *
   * Optional: a connector that only reports balances is still a connector, and
   * the aggregate falls back to the CAIP id rather than requiring this.
   */
  chainName?(chainId: string): string | null
}
