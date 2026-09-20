import type { ArmSummary, AssetRow, PositionGroup, Portfolio, ProtocolRow } from '@/lib/api'

/** A 0..1 share of a net total, or nothing when there is no positive whole to be a share of. */
function shareOf(value: number, total: number): number {
  return total > 0 && value > 0 ? value / total : 0
}

/**
 * The portfolio narrowed to one network, or the whole of it — with every
 * displayed total re-derived from the same set of visible positions, so the
 * header, the cards, the shares and the wallet figures never disagree.
 *
 * Shares are of the net total on both paths, the way a portfolio app reads
 * "Wallet 28%, Fluid 71%". Debt makes the whole smaller than its parts, so a
 * card can exceed 100%; that is honest, and a share of a non-positive whole
 * is zero rather than nonsense.
 */
export function selectPortfolio(portfolio: Portfolio, chainId: string | null, walletId: string | null = null) {
  const assets = portfolio.assets
    .filter((row) => !chainId || row.chainId === chainId)
    .map((row) => (walletId ? sliceAsset(row, walletId) : row))
    .filter((row): row is AssetRow => row !== null)
  const protocols: ProtocolRow[] = portfolio.protocols
    .map((app) => {
      const groups = app.groups
        .filter((group) => !chainId || group.chainId === chainId)
        .map((group) => (walletId ? sliceGroup(group, walletId) : group))
        .filter((group): group is PositionGroup => group !== null)
      return {
        ...app,
        groups,
        value: groups.reduce((sum, group) => sum + group.value, 0),
        change1d: groups.reduce((sum, group) => sum + group.change1d, 0),
        unpriced: groups.reduce((sum, group) => sum + group.unpriced, 0),
      }
    })
    .filter((app) => app.groups.length > 0)

  const walletValue = assets.reduce((sum, row) => sum + row.value, 0)
  const walletUnpriced = assets.reduce(
    (sum, row) => sum + row.holdings.filter((holding) => holding.value === null).length, 0)
  const unpriced = walletUnpriced + protocols.reduce((sum, app) => sum + app.unpriced, 0)
  const total = walletValue + protocols.reduce((sum, app) => sum + app.value, 0)
  const change1d =
    assets.reduce((sum, row) => sum + row.change1d, 0) +
    protocols.reduce((sum, app) => sum + app.change1d, 0)

  // Each arm's net on the visible set: its loose balances plus its protocol
  // positions, debt subtracted — the same arithmetic the service does for the
  // whole, applied to the slice.
  const armTotals = new Map<string, number>()
  const add = (walletId: string, value: number) =>
    armTotals.set(walletId, (armTotals.get(walletId) ?? 0) + value)
  for (const row of assets) for (const holding of row.holdings) add(holding.walletId, holding.value ?? 0)
  for (const app of protocols) {
    for (const group of app.groups) {
      for (const holding of group.holdings) {
        add(holding.walletId, (holding.positionType === 'loan' ? -1 : 1) * (holding.value ?? 0))
      }
    }
  }

  const arms: (ArmSummary & { share: number })[] = portfolio.arms.map((arm) => {
    const armTotal = armTotals.get(arm.walletId) ?? 0
    return { ...arm, total: armTotal, share: shareOf(armTotal, total) }
  })

  return {
    ...portfolio,
    total,
    change1d,
    unpriced,
    wallet: { value: walletValue, share: shareOf(walletValue, total), unpriced: walletUnpriced },
    assets: assets.map((row) => ({ ...row, share: shareOf(row.value, total) })),
    // What has no price counts as nothing, and a card's share is of what it is worth.
    protocols: protocols.map((app) => ({ ...app, share: shareOf(app.value, total) })),
    arms,
  }
}

export type SelectedPortfolio = ReturnType<typeof selectPortfolio>

/**
 * One wallet's part of a loose balance. Every holding in the row is the same
 * asset at the same price, so the day's change divides exactly by amount —
 * this is arithmetic on what the provider said, not a new reading. Null when
 * the wallet holds none of it.
 */
function sliceAsset(row: AssetRow, walletId: string): AssetRow | null {
  const holdings = row.holdings.filter((h) => h.walletId === walletId)
  if (holdings.length === 0) return null
  const amount = holdings.reduce((sum, h) => sum + BigInt(h.amount), 0n)
  const whole = BigInt(row.amount)
  const fraction = whole > 0n ? Number(amount) / Number(whole) : 0
  return {
    ...row,
    holdings,
    amount: amount.toString(),
    value: holdings.reduce((sum, h) => sum + (h.value ?? 0), 0),
    change1d: row.change1d * fraction,
  }
}

/** One wallet's positions in a pool or market: value and change re-summed from its own rows. */
function sliceGroup(group: PositionGroup, walletId: string): PositionGroup | null {
  const holdings = group.holdings.filter((h) => h.walletId === walletId)
  if (holdings.length === 0) return null
  const sign = (h: PositionGroup['holdings'][number]) => (h.positionType === 'loan' ? -1 : 1)
  return {
    ...group,
    holdings,
    value: holdings.reduce((sum, h) => sum + sign(h) * (h.value ?? 0), 0),
    change1d: holdings.reduce((sum, h) => sum + sign(h) * (h.change1d ?? 0), 0),
    unpriced: holdings.filter((h) => h.value === null).length,
  }
}
