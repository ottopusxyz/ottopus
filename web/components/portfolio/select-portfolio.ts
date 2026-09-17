import type { Portfolio } from '@/lib/api'

/** Derive every displayed total from the same set of visible positions. */
export function selectPortfolio(portfolio: Portfolio, chainId: string | null) {
  const assets = portfolio.assets.filter((row) => !chainId || row.chainId === chainId)
  const total = assets.reduce((sum, row) => sum + row.value, 0)
  const gross = assets.reduce((sum, row) => sum + Math.max(0, row.value), 0)
  const share = (value: number) => gross > 0 ? Math.max(0, value) / gross : 0
  return {
    ...portfolio,
    total,
    gross,
    change1d: assets.reduce((sum, row) => sum + row.change1d, 0),
    assets: assets.map((row) => ({ ...row, share: share(row.value) })),
    arms: portfolio.arms.map((arm) => {
      let total = 0
      let positive = 0
      for (const row of assets) {
        const value = row.holdings.filter((holding) => holding.walletId === arm.walletId)
          .reduce((sum, holding) => sum + (holding.value ?? 0), 0)
        total += value
        // Allocate each positive asset row between its positive wallet contributions.
        const positiveContributions = portfolio.arms.reduce((sum, candidate) => sum + Math.max(0,
          row.holdings.filter((holding) => holding.walletId === candidate.walletId)
            .reduce((value, holding) => value + (holding.value ?? 0), 0)), 0)
        if (positiveContributions > 0) positive += Math.max(0, row.value) * Math.max(0, value) / positiveContributions
      }
      return { ...arm, total, share: share(positive) }
    }),
  }
}
