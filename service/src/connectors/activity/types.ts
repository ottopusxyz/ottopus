/**
 * What an activity provider has to answer: one wallet's on-chain history, a
 * page at a time, in words the web app can draw without knowing the vendor.
 *
 * The same boundary the portfolio connector keeps — chains are CAIP-2,
 * amounts are base-unit strings, and the kinds are the set a history feed
 * converges on rather than any one provider's enum. The merge across arms
 * lives above this, in `merge.ts`, so a second provider has one small thing
 * to get right.
 */

import type { AccountRef } from '../portfolio/types.js'

/** What a transaction did, as the provider decoded it. One per transaction. */
export type ActivityKind =
  | 'send'
  | 'receive'
  | 'trade'
  | 'deposit'
  | 'withdraw'
  | 'approve'
  | 'revoke'
  | 'claim'
  | 'mint'
  | 'burn'
  | 'execute'
  | 'deploy'
  | 'delegate'
  | 'revoke_delegation'
  | 'bid'

export const ACTIVITY_KINDS: readonly ActivityKind[] = [
  'send',
  'receive',
  'trade',
  'deposit',
  'withdraw',
  'approve',
  'revoke',
  'claim',
  'mint',
  'burn',
  'execute',
  'deploy',
  'delegate',
  'revoke_delegation',
  'bid',
]

/** `failed` means mined and reverted; nothing moved except the fee. */
export type ActivityStatus = 'confirmed' | 'failed' | 'pending'

export type TransferAsset =
  | {
      kind: 'fungible'
      symbol: string
      name: string
      iconUrl: string | null
      /** The provider vouches for this token's identity. Shown, never trusted. */
      verified: boolean
    }
  | {
      kind: 'nft'
      name: string
      imageUrl: string | null
      contract: string
      tokenId: string
    }

/** One movement of one asset inside a transaction. */
export interface Transfer {
  /** `self` is a wallet paying itself: a wrap, a rebalance, a test. */
  direction: 'in' | 'out' | 'self'
  asset: TransferAsset
  /** Base units, integer string. An NFT moves as "1" with zero decimals. */
  amount: string
  decimals: number
  /** In the requested currency at the time it was mined. Null when unpriced. */
  value: number | null
  price: number | null
  sender: string
  recipient: string
}

/** A spending allowance the transaction granted or withdrew. */
export interface Approval {
  asset: TransferAsset
  amount: string
  decimals: number
  /** The allowance is effectively infinite — the max uint, or near it. */
  unlimited: boolean
  spender: string
}

export interface Fee {
  symbol: string
  amount: string
  decimals: number
  value: number | null
}

/** The app the wallet talked to, when the provider recognised it. */
export interface AppRef {
  name: string | null
  iconUrl: string | null
  contract: string
  /** The called function's name, when known — "Multicall", "Exec Transaction". */
  method: string | null
}

/** One transaction, as it concerns one wallet. */
export interface Activity {
  /** The provider's id for the transaction. Unique within one wallet's history. */
  id: string
  hash: string
  /** CAIP-2. */
  chainId: string
  /** ISO 8601, second precision. */
  minedAt: string
  block: number
  status: ActivityStatus
  kind: ActivityKind
  from: string
  to: string
  fee: Fee | null
  transfers: Transfer[]
  approvals: Approval[]
  app: AppRef | null
}

export interface ActivityQuery {
  /** Only these kinds. Absent means every kind. */
  kinds?: readonly ActivityKind[] | undefined
  /** Only this chain, CAIP-2. */
  chainId?: string | undefined
  /**
   * Only transactions mined at or before this instant, ISO 8601. The merge
   * drops the ones it already has; the provider only has to bound the page.
   */
  before?: string | undefined
  /** How many at most. */
  size: number
}

export interface ActivityPageRead {
  items: Activity[]
  /** The provider has older transactions past this page. */
  more: boolean
  /**
   * Every row the provider put on the page, in its order, the dropped ones
   * included. The merge advances its bound over these, so a page of rows it
   * could not name still moves the feed along instead of stalling it.
   */
  raw: { id: string; minedAt: string }[]
}

export interface ActivityConnector {
  readonly provider: string
  /**
   * One page of one account's history, newest first.
   *
   * Throws `PortfolioError` and nothing else, for the same reason the
   * portfolio connector does: the merge reads one arm out of eight and has to
   * tell "untracked" apart from "the vendor is down" without reading prose.
   */
  transactionsFor(account: AccountRef, query: ActivityQuery): Promise<ActivityPageRead>
  chainName?(chainId: string): string | null
  chainIcon?(chainId: string): string | null
}
