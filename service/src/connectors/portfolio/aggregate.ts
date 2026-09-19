/**
 * Eight arms, one portfolio — and the per-arm breakdown kept intact underneath.
 *
 * This is the half of the portfolio no provider does for us. Zerion reads one
 * account at a time, so the fan-out, the merging and the failure accounting all
 * live here, above the connector boundary, which means #30's second provider
 * inherits every decision in this file for free.
 *
 * Two lists come out, and they never share a row:
 *
 * - `assets`: what sits loose in the wallets, one row per asset per chain,
 *   merged across arms. Every amount here is one a plan could spend, and no
 *   value is ever negative.
 * - `protocols`: everything deposited, borrowed, staked, locked, vesting or
 *   claimable, one entry per app, grouped the way the app itself groups it —
 *   a lending market with its collateral and its debt, an AMM pool with both
 *   its tokens. Debt lives here, under a type, not as a minus sign on a token.
 *
 * Two rules the tests hold to:
 *
 * 1. **Amounts are BigInt, always.** Balances are base units; 10^18 exceeds
 *    Number.MAX_SAFE_INTEGER, and two arms' worth of ETH added as floats is a
 *    number someone would sign against.
 * 2. **One failed arm is not a failed portfolio.** An arm Zerion cannot read
 *    reports itself as unread and the other seven still add up. Blanking the
 *    page because one pasted address is a token contract reads as data loss.
 */

import {
  PortfolioError,
  POSITION_TYPES,
  type AccountPosition,
  type AccountRef,
  type AssetInfo,
  type PortfolioConnector,
  type PortfolioErrorCode,
  type PositionType,
  type ProtocolModule,
} from './types.js'

/** An arm to read: our wallet id, plus what the connector needs. */
export interface ArmRef extends AccountRef {
  walletId: string
}

export type ArmStatus = 'ok' | PortfolioErrorCode

export interface ArmSummary {
  walletId: string
  address: string
  status: ArmStatus
  /** Net: what this arm holds less what it owes. Zero when it could not be read. */
  total: number
  change1d: number
  positionCount: number
}

/** One arm's share of a token row. */
export interface Holding {
  walletId: string
  /** Base units. */
  amount: string
  value: number | null
}

/** A loose balance: one asset, on one chain, across every arm. */
export interface AssetRow {
  /** CAIP-19. The merge key. */
  assetId: string
  chainId: string
  asset: AssetInfo
  /** Base units, summed across arms. */
  amount: string
  /** Never negative: debt is not a token you hold. Zero when unpriced. */
  value: number
  price: number | null
  change1d: number
  /** Fraction of the net total, 0..1. See `share` on the portfolio. */
  share: number
  holdings: Holding[]
}

/** How a protocol position is being used. Never `wallet` — that is the token list. */
export type ProtocolPositionType = Exclude<PositionType, 'wallet'>

/** One position of one arm inside a protocol. Not merged across arms: the row says whose it is. */
export interface ProtocolHolding {
  walletId: string
  assetId: string
  chainId: string
  asset: AssetInfo
  positionType: ProtocolPositionType
  /** Base units. */
  amount: string
  /** A magnitude. For a loan, what is owed. Null when unpriced. */
  value: number | null
  price: number | null
  /** As the provider reports it. For a loan, the change in what is owed. */
  change1d: number | null
}

/**
 * What the app itself treats as one thing: a lending market, a pool, a vault,
 * a vesting schedule. Collateral and the debt against it share a group, and so
 * do the two sides of an LP pair — which is why the group, not the row, is
 * where a net value first means something.
 */
export interface PositionGroup {
  /** The provider's group id, or the position name when it gave none. Unique within a protocol and chain. */
  id: string
  chainId: string
  /** "Fluid Lending (#9468)", "USDC/WETH". */
  name: string
  module: ProtocolModule | null
  /** Net: deposits less loans. Negative for debt with no collateral beside it. */
  value: number
  change1d: number
  /**
   * Holdings the provider could not price. They count as zero in `value`, so
   * a group with any is a partial figure — and debt against unpriced
   * collateral is not net debt, it is unknown.
   */
  unpriced: number
  holdings: ProtocolHolding[]
}

export interface ProtocolRow {
  /** The app's slug, shared across chains and arms. */
  id: string
  name: string
  iconUrl: string | null
  url: string | null
  /** Net across every group. */
  value: number
  change1d: number
  /** Fraction of the net total, 0..1. Zero for a protocol that is net debt or partly unpriced. */
  share: number
  /** Unpriced holdings across every group. See `PositionGroup.unpriced`. */
  unpriced: number
  groups: PositionGroup[]
}

export interface ChainRow {
  iconUrl?: string | null
  chainId: string
  /** The provider's human name, or the CAIP id when it has none. */
  name: string
  /** Net across tokens and protocols on this chain. */
  value: number
  share: number
}

/** Magnitudes per way of holding — what is loose, deposited, owed, staked, and so on. */
export type ValueByType = Record<PositionType, number>

export interface Portfolio {
  provider: string
  currency: 'usd'
  /** When this was read. Not when it was last correct — see each arm's status. */
  asOf: string
  /** Net worth: everything held less everything owed, across every arm that could be read. */
  total: number
  change1d: number
  /**
   * Every `share` is a fraction of `total` — the way a portfolio app reads
   * "Wallet 28%, Fluid 71%". With debt in the picture a card can exceed the
   * whole, and that is honest: the rest is negative. When the total itself is
   * not positive there is nothing to be a share of, and every share is zero.
   */
  byType: ValueByType
  /** Holdings with no price anywhere in the portfolio. `total` leaves them out. */
  unpriced: number
  arms: ArmSummary[]
  chains: ChainRow[]
  assets: AssetRow[]
  protocols: ProtocolRow[]
}

/** Zero rather than null: a portfolio with no arms is empty, not unknown. */
function shareOf(value: number, total: number): number {
  if (total <= 0 || value <= 0) return 0
  return value / total
}

function statusOf(error: unknown): ArmStatus {
  return error instanceof PortfolioError ? error.code : 'unavailable'
}

interface ArmRead {
  arm: ArmRef
  positions: AccountPosition[]
  status: ArmStatus
}

/** The sign a position carries into a total: debt subtracts, everything else adds. */
function signOf(positionType: PositionType): 1 | -1 {
  return positionType === 'loan' ? -1 : 1
}

/**
 * Read every arm in parallel and fold them into one portfolio.
 *
 * `allSettled`, not `all`: `all` rejects on the first arm that fails and throws
 * away the seven that succeeded, which is precisely the outcome this function
 * exists to prevent.
 */
export async function readPortfolio(
  connector: PortfolioConnector,
  arms: readonly ArmRef[],
): Promise<Portfolio> {
  const settled = await Promise.allSettled(arms.map((arm) => connector.positionsFor(arm)))

  const reads: ArmRead[] = settled.map((result, i) => {
    const arm = arms[i]!
    return result.status === 'fulfilled'
      ? { arm, positions: result.value, status: 'ok' as const }
      : { arm, positions: [], status: statusOf(result.reason) }
  })

  return aggregate(
    connector.provider, reads,
    (chainId) => connector.chainName?.(chainId) ?? null,
    (chainId) => connector.chainIcon?.(chainId) ?? null,
  )
}

/** Deposits first, then the other ways of holding, debt last — the order a lending card reads in. */
const TYPE_ORDER: readonly ProtocolPositionType[] = ['deposit', 'staked', 'locked', 'investment', 'reward', 'loan']

function byTypeThenValue(a: ProtocolHolding, b: ProtocolHolding): number {
  const order = TYPE_ORDER.indexOf(a.positionType) - TYPE_ORDER.indexOf(b.positionType)
  return order !== 0 ? order : (b.value ?? 0) - (a.value ?? 0)
}

/**
 * The fold itself, with no I/O in it — which is why every merging rule in this
 * file is testable without a network or a fake connector.
 */
export function aggregate(
  provider: string,
  reads: readonly ArmRead[],
  chainName: (chainId: string) => string | null = () => null,
  chainIcon: (chainId: string) => string | null = () => null,
): Portfolio {
  const rows = new Map<string, AssetRow>()
  const protocols = new Map<string, ProtocolRow>()
  const groups = new Map<string, PositionGroup>()
  const arms: ArmSummary[] = []
  const byType = Object.fromEntries(POSITION_TYPES.map((type) => [type, 0])) as ValueByType
  const chainValues = new Map<string, number>()
  let unpriced = 0

  for (const { arm, positions, status } of reads) {
    let armTotal = 0
    let armChange = 0

    for (const position of positions) {
      const sign = signOf(position.positionType)
      const value = position.value ?? 0
      if (position.value === null) unpriced++
      armTotal += sign * value
      armChange += sign * (position.change1d ?? 0)
      byType[position.positionType] += value
      chainValues.set(position.chainId, (chainValues.get(position.chainId) ?? 0) + sign * value)

      if (position.positionType === 'wallet') {
        let row = rows.get(position.assetId)
        if (!row) {
          row = {
            assetId: position.assetId,
            chainId: position.chainId,
            asset: position.asset,
            amount: '0',
            value: 0,
            price: position.price,
            change1d: 0,
            share: 0,
            holdings: [],
          }
          rows.set(position.assetId, row)
        }

        // BigInt, not Number. Two arms' ETH balances added as floats round at
        // the seventeenth digit, and base units routinely have more than that.
        row.amount = (BigInt(row.amount) + BigInt(position.amount)).toString()
        row.value += value
        row.change1d += position.change1d ?? 0
        // A price arriving on a later arm is better than no price at all.
        row.price ??= position.price
        row.holdings.push({ walletId: arm.walletId, amount: position.amount, value: position.value })
        continue
      }

      // A protocol position with no app behind it cannot be filed anywhere
      // honest. The connector names one for anything with a protocol, so this
      // is a guard on the type rather than a case that happens.
      const dappId = position.dappId ?? position.protocol ?? 'unknown'
      let protocol = protocols.get(dappId)
      if (!protocol) {
        protocol = {
          id: dappId,
          name: position.protocol ?? dappId,
          iconUrl: position.dappIconUrl,
          url: position.dappUrl,
          value: 0,
          change1d: 0,
          share: 0,
          unpriced: 0,
          groups: [],
        }
        protocols.set(dappId, protocol)
      }
      protocol.iconUrl ??= position.dappIconUrl
      protocol.url ??= position.dappUrl

      // Keyed by chain as well: the same pool id on two chains is two pools,
      // and the same pool on two arms is one pool with a row for each arm.
      const groupId = position.groupId ?? position.positionName ?? position.assetId
      const groupKey = `${dappId} ${position.chainId} ${groupId}`
      let group = groups.get(groupKey)
      if (!group) {
        group = {
          id: groupId,
          chainId: position.chainId,
          name: position.positionName ?? position.protocol ?? dappId,
          module: position.protocolModule,
          value: 0,
          change1d: 0,
          unpriced: 0,
          holdings: [],
        }
        groups.set(groupKey, group)
        protocol.groups.push(group)
      }
      group.module ??= position.protocolModule
      group.value += sign * value
      group.change1d += sign * (position.change1d ?? 0)
      if (position.value === null) {
        group.unpriced++
        protocol.unpriced++
      }
      group.holdings.push({
        walletId: arm.walletId,
        assetId: position.assetId,
        chainId: position.chainId,
        asset: position.asset,
        positionType: position.positionType,
        amount: position.amount,
        value: position.value,
        price: position.price,
        change1d: position.change1d,
      })
      protocol.value += sign * value
      protocol.change1d += sign * (position.change1d ?? 0)
    }

    arms.push({
      walletId: arm.walletId,
      address: arm.address,
      status,
      total: armTotal,
      change1d: armChange,
      positionCount: positions.length,
    })
  }

  const assets = [...rows.values()].sort((a, b) => b.value - a.value)
  const apps = [...protocols.values()].sort((a, b) => b.value - a.value)
  for (const app of apps) {
    app.groups.sort((a, b) => b.value - a.value)
    for (const group of app.groups) group.holdings.sort(byTypeThenValue)
  }

  let total = 0
  let change1d = 0
  for (const row of assets) {
    total += row.value
    change1d += row.change1d
  }
  for (const app of apps) {
    total += app.value
    change1d += app.change1d
  }

  for (const row of assets) row.share = shareOf(row.value, total)
  // A partly priced card has no honest share: its value is a floor, not a figure.
  for (const app of apps) app.share = app.unpriced > 0 ? 0 : shareOf(app.value, total)

  const chains: ChainRow[] = [...chainValues.entries()]
    .map(([chainId, value]) => ({
      chainId,
      name: chainName(chainId) ?? chainId,
      iconUrl: chainIcon(chainId),
      value,
      share: shareOf(value, total),
    }))
    .sort((a, b) => b.value - a.value)

  return {
    provider,
    currency: 'usd',
    asOf: new Date().toISOString(),
    total,
    change1d,
    byType,
    unpriced,
    arms,
    chains,
    assets,
    protocols: apps,
  }
}
