/**
 * Eight arms, one portfolio — and the per-arm breakdown kept intact underneath.
 *
 * This is the half of the portfolio no provider does for us. Zerion reads one
 * account at a time, so the fan-out, the merging and the failure accounting all
 * live here, above the connector boundary, which means #30's second provider
 * inherits every decision in this file for free.
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
  isSpendable,
  type AccountPosition,
  type AccountRef,
  type AssetInfo,
  type PortfolioConnector,
  type PortfolioErrorCode,
  type PositionType,
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
  /** Signed sum of this arm's positions. Zero when it could not be read. */
  total: number
  change1d: number
  positionCount: number
}

/** One arm's share of an asset row, kept so the wallets view has something to show. */
export interface Holding {
  walletId: string
  positionType: PositionType
  /** Base units. */
  amount: string
  value: number | null
  protocol: string | null
  /** Holdings sharing this belong to one pool. */
  groupId: string | null
}

export interface AssetRow {
  /** CAIP-19. The merge key: one asset, on one chain, across every arm. */
  assetId: string
  chainId: string
  asset: AssetInfo
  /** Base units, summed across arms. */
  amount: string
  /** Base units held loosely — what a plan could actually spend. */
  spendable: string
  /** Signed: a row that is only debt is negative. */
  value: number
  price: number | null
  change1d: number
  /** Fraction of gross holdings, 0..1. See `share` on the portfolio. */
  share: number
  holdings: Holding[]
}

export interface ChainRow {
  chainId: string
  /** The provider's human name, or the CAIP id when it has none. */
  name: string
  value: number
  share: number
}

export interface Portfolio {
  provider: string
  currency: 'usd'
  /** When this was read. Not when it was last correct — see each arm's status. */
  asOf: string
  /** Signed sum across every arm that could be read. */
  total: number
  /**
   * Denominator for every `share`: the sum of positive values.
   *
   * Not `total`, because debt makes `total` smaller than the holdings it is
   * made of, and a row's share of a net worth reduced by a loan can exceed
   * 100%. Share is share of what is held.
   */
  gross: number
  change1d: number
  arms: ArmSummary[]
  chains: ChainRow[]
  assets: AssetRow[]
}

/** Zero rather than null: a portfolio with no arms is empty, not unknown. */
function shareOf(value: number, gross: number): number {
  if (gross <= 0 || value <= 0) return 0
  return value / gross
}

function statusOf(error: unknown): ArmStatus {
  return error instanceof PortfolioError ? error.code : 'unavailable'
}

interface ArmRead {
  arm: ArmRef
  positions: AccountPosition[]
  status: ArmStatus
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

  return aggregate(connector.provider, reads, (chainId) => connector.chainName?.(chainId) ?? null)
}

/**
 * The fold itself, with no I/O in it — which is why every merging rule in this
 * file is testable without a network or a fake connector.
 */
export function aggregate(
  provider: string,
  reads: readonly ArmRead[],
  chainName: (chainId: string) => string | null = () => null,
): Portfolio {
  const rows = new Map<string, AssetRow>()
  const arms: ArmSummary[] = []

  for (const { arm, positions, status } of reads) {
    let armTotal = 0
    let armChange = 0

    for (const position of positions) {
      armTotal += position.value ?? 0
      armChange += position.change1d ?? 0

      let row = rows.get(position.assetId)
      if (!row) {
        row = {
          assetId: position.assetId,
          chainId: position.chainId,
          asset: position.asset,
          amount: '0',
          spendable: '0',
          value: 0,
          price: position.price,
          change1d: 0,
          share: 0,
          holdings: [],
        }
        rows.set(position.assetId, row)
      }

      // BigInt, not Number. Two arms' ETH balances added as floats round at the
      // seventeenth digit, and base units routinely have more than that.
      row.amount = (BigInt(row.amount) + BigInt(position.amount)).toString()
      if (isSpendable(position.positionType)) {
        row.spendable = (BigInt(row.spendable) + BigInt(position.amount)).toString()
      }
      row.value += position.value ?? 0
      row.change1d += position.change1d ?? 0
      // A price arriving on a later arm is better than no price at all.
      row.price ??= position.price
      row.holdings.push({
        walletId: arm.walletId,
        positionType: position.positionType,
        amount: position.amount,
        value: position.value,
        protocol: position.protocol,
        groupId: position.groupId,
      })
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

  let total = 0
  let gross = 0
  let change1d = 0
  const chainValues = new Map<string, number>()

  for (const row of assets) {
    total += row.value
    if (row.value > 0) gross += row.value
    change1d += row.change1d
    chainValues.set(row.chainId, (chainValues.get(row.chainId) ?? 0) + row.value)
  }

  for (const row of assets) row.share = shareOf(row.value, gross)

  const chains: ChainRow[] = [...chainValues.entries()]
    .map(([chainId, value]) => ({
      chainId,
      name: chainName(chainId) ?? chainId,
      value,
      share: shareOf(value, gross),
    }))
    .sort((a, b) => b.value - a.value)

  return {
    provider,
    currency: 'usd',
    asOf: new Date().toISOString(),
    total,
    gross,
    change1d,
    arms,
    chains,
    assets,
  }
}
