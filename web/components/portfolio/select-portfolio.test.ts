import { describe, expect, it } from 'vitest'
import type { AssetRow, Portfolio } from '@/lib/api'
import { selectPortfolio } from './select-portfolio'

function row(chainId: string, values: number[], change1d = 0): AssetRow {
  return {
    assetId: `${chainId}/erc20:token`, chainId,
    asset: { symbol: 'TOKEN', name: 'Token', decimals: 18, iconUrl: null, verified: true },
    amount: '2000000000000000001', spendable: '1000000000000000001',
    value: values.reduce((sum, value) => sum + value, 0), price: 1, change1d, share: 0,
    holdings: values.map((value, i) => ({
      walletId: `wallet-${i}`, positionType: value < 0 ? 'loan' : 'wallet',
      amount: '1000000000000000000', value, protocol: null, groupId: null,
    })),
  }
}
const portfolio: Portfolio = {
  provider: 'zerion', currency: 'usd', asOf: '2026-09-08T00:00:00Z',
  total: 130, gross: 150, change1d: 4, chains: [],
  assets: [row('eip155:1', [100, 50], 5), row('eip155:8453', [-20], -1)],
  arms: [
    { walletId: 'wallet-0', address: '0x1', status: 'ok', total: 80, change1d: 4, positionCount: 2 },
    { walletId: 'wallet-1', address: '0x2', status: 'ok', total: 50, change1d: 0, positionCount: 1 },
    { walletId: 'missing', address: '0x3', status: 'unavailable', total: 0, change1d: 0, positionCount: 0 },
  ],
}

describe('portfolio network selection', () => {
  it('keeps net totals equal to rows and wallets, with positive shares independent of debt', () => {
    const selected = selectPortfolio(portfolio, null)
    expect(selected.total).toBe(130)
    expect(selected.total).toBe(selected.arms.reduce((sum, arm) => sum + arm.total, 0))
    expect(selected.gross).toBe(150)
    expect(selected.change1d).toBe(4)
    expect(selected.assets.map((asset) => asset.share)).toEqual([1, 0])
    expect(selected.arms.reduce((sum, arm) => sum + arm.share, 0)).toBeCloseTo(1)
    expect(selected.arms[2]?.status).toBe('unavailable')
  })

  it('filters totals, deltas, wallet values, and shares together without mutating the response', () => {
    const selected = selectPortfolio(portfolio, 'eip155:1')
    expect(selected.total).toBe(150)
    expect(selected.change1d).toBe(5)
    expect(selected.arms.map((arm) => arm.total)).toEqual([100, 50, 0])
    expect(selected.assets).toHaveLength(1)
    expect(selected.assets[0]?.amount).toBe('2000000000000000001')
    expect(selected.assets[0]?.spendable).toBe('1000000000000000001')
    expect(portfolio.assets[0]?.share).toBe(0)
    expect(portfolio.arms[0]?.total).toBe(80)
  })

  it('handles a debt-only network and an empty network without invalid percentages', () => {
    const debt = selectPortfolio(portfolio, 'eip155:8453')
    expect(debt.total).toBe(-20)
    expect(debt.gross).toBe(0)
    expect(debt.arms.every((arm) => arm.share === 0)).toBe(true)
    const empty = selectPortfolio(portfolio, 'eip155:10')
    expect(empty.assets).toEqual([])
    expect(empty.total).toBe(0)
    expect(empty.change1d).toBe(0)
  })
})
