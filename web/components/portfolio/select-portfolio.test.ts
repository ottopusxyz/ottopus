import { describe, expect, it } from 'vitest'
import type { AssetRow, Portfolio, ProtocolHolding, ProtocolRow } from '@/lib/api'
import { selectPortfolio } from './select-portfolio'

const ASSET = { symbol: 'TOKEN', name: 'Token', decimals: 18, iconUrl: null, verified: true }

function row(chainId: string, values: number[], change1d = 0): AssetRow {
  return {
    assetId: `${chainId}/erc20:token`, chainId, asset: ASSET,
    amount: '2000000000000000001',
    value: values.reduce((sum, value) => sum + value, 0), price: 1, change1d, share: 0,
    holdings: values.map((value, i) => ({ walletId: `wallet-${i}`, amount: '1000000000000000000', value })),
  }
}

function holding(walletId: string, chainId: string, positionType: ProtocolHolding['positionType'], value: number): ProtocolHolding {
  return {
    walletId, assetId: `${chainId}/erc20:token`, chainId, asset: ASSET, positionType,
    amount: '1000000000000000000', value, price: 1, change1d: 0,
  }
}

/** A lending market on Base for wallet-0, and a vault on Ethereum for wallet-1. */
const fluid: ProtocolRow = {
  id: 'fluid', name: 'Fluid', iconUrl: null, url: null, value: 80, change1d: 1, share: 0,
  groups: [
    {
      id: 'm', chainId: 'eip155:8453', name: 'Fluid Lending', module: 'lending', value: 80, change1d: 1,
      holdings: [holding('wallet-0', 'eip155:8453', 'deposit', 100), holding('wallet-0', 'eip155:8453', 'loan', 20)],
    },
  ],
}
const morpho: ProtocolRow = {
  id: 'morpho', name: 'Morpho', iconUrl: null, url: null, value: 30, change1d: -2, share: 0,
  groups: [
    { id: 'v', chainId: 'eip155:1', name: 'WETH Vault', module: 'yield', value: 30, change1d: -2, holdings: [holding('wallet-1', 'eip155:1', 'deposit', 30)] },
  ],
}

const portfolio: Portfolio = {
  provider: 'zerion', currency: 'usd', asOf: '2026-09-08T00:00:00Z',
  total: 260, change1d: 3, chains: [],
  byType: { wallet: 150, deposit: 130, loan: 20, locked: 0, staked: 0, reward: 0, investment: 0 },
  assets: [row('eip155:1', [100, 50], 5), row('eip155:8453', [0], -1)],
  protocols: [fluid, morpho],
  arms: [
    { walletId: 'wallet-0', address: '0x1', status: 'ok', total: 180, change1d: 4, positionCount: 4 },
    { walletId: 'wallet-1', address: '0x2', status: 'ok', total: 80, change1d: 0, positionCount: 2 },
    { walletId: 'missing', address: '0x3', status: 'unavailable', total: 0, change1d: 0, positionCount: 0 },
  ],
}

describe('portfolio network selection', () => {
  it('re-derives the whole from tokens and protocols, with shares of the net total', () => {
    const selected = selectPortfolio(portfolio, null)
    expect(selected.total).toBe(260)
    expect(selected.change1d).toBe(3)
    expect(selected.wallet).toEqual({ value: 150, share: 150 / 260 })
    expect(selected.protocols.map((app) => app.share)).toEqual([80 / 260, 30 / 260])
    expect(selected.assets.map((asset) => asset.share)).toEqual([150 / 260, 0])
    // Wallet plus every card is the whole.
    expect(selected.wallet.share + selected.protocols.reduce((sum, app) => sum + app.share, 0)).toBeCloseTo(1)
    // Each arm's total is net of its debt, and the arms add up to the whole.
    expect(selected.arms.map((arm) => arm.total)).toEqual([180, 80, 0])
    expect(selected.arms.reduce((sum, arm) => sum + arm.total, 0)).toBe(260)
    expect(selected.arms[2]?.status).toBe('unavailable')
  })

  it('filters tokens, protocol groups, totals, deltas and wallet values together without mutating the response', () => {
    const selected = selectPortfolio(portfolio, 'eip155:8453')
    expect(selected.total).toBe(80)
    expect(selected.change1d).toBe(0)
    expect(selected.assets).toHaveLength(1)
    expect(selected.wallet.value).toBe(0)
    // Morpho has nothing on Base, so it is not a card here.
    expect(selected.protocols.map((app) => app.id)).toEqual(['fluid'])
    expect(selected.protocols[0]?.share).toBe(1)
    expect(selected.arms.map((arm) => arm.total)).toEqual([80, 0, 0])
    expect(portfolio.protocols[1]?.groups).toHaveLength(1)
    expect(portfolio.arms[0]?.total).toBe(180)
  })

  it('handles a debt-only network and an empty network without invalid percentages', () => {
    const debtOnly: Portfolio = {
      ...portfolio,
      assets: [],
      protocols: [{ ...fluid, groups: [{ ...fluid.groups[0]!, value: -20, holdings: [holding('wallet-0', 'eip155:8453', 'loan', 20)] }] }],
    }
    const debt = selectPortfolio(debtOnly, 'eip155:8453')
    expect(debt.total).toBe(-20)
    expect(debt.protocols[0]?.value).toBe(-20)
    expect(debt.protocols[0]?.share).toBe(0)
    expect(debt.arms.every((arm) => arm.share === 0)).toBe(true)
    expect(debt.arms[0]?.total).toBe(-20)

    const empty = selectPortfolio(portfolio, 'eip155:10')
    expect(empty.assets).toEqual([])
    expect(empty.protocols).toEqual([])
    expect(empty.total).toBe(0)
    expect(empty.change1d).toBe(0)
  })
})
