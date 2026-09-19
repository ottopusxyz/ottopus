import { describe, expect, it } from 'vitest'
import type { AssetRow } from '@/lib/api'
import { compactBalance, groupTokens } from './group-tokens'

function row(chain: string, familyId: string | null, decimals: number, amount: string, value: number): AssetRow {
  return {
    assetId: `${chain}/erc20:contract`, chainId: chain,
    asset: { familyId, symbol: 'USDC', name: 'USD Coin', decimals, verified: true, iconUrl: null },
    amount, value, share: value > 0 ? value / 10 : 0, change1d: 0, price: 1,
    holdings: [{ walletId: 'wallet', amount, value }],
  }
}

describe('grouped token balances', () => {
  it('merges a token across networks using provider identity and exact decimal normalization', () => {
    const rows = [row('eip155:1', 'zerion:usdc', 6, '1000001', 1), row('eip155:56', 'zerion:usdc', 18, '2000000000000000001', 2)]
    const [group] = groupTokens(rows)
    expect(group?.amount).toBe('3000001000000000001')
    expect(group?.asset.decimals).toBe(18)
    expect(group?.value).toBe(3)
    expect(group?.networks).toHaveLength(2)
    expect(group?.networks.find((network) => network.chainId === 'eip155:1')?.amount).toBe('1000001000000000000')
    expect(rows[0]?.amount).toBe('1000001')
  })

  it('never merges identical tickers with different or missing identities', () => {
    const groups = groupTokens([
      row('eip155:1', 'zerion:usdc', 6, '1', 1),
      row('eip155:56', 'zerion:imposter', 6, '1', 1),
      row('eip155:8453', null, 6, '1', 1),
      row('eip155:10', null, 6, '1', 1),
    ])
    expect(groups).toHaveLength(4)
  })

  it('keeps verification and pricing honest across a group', () => {
    const verified = row('eip155:1', 'zerion:usdc', 6, '5000000', 5)
    const unverified = row('eip155:8453', 'zerion:usdc', 6, '2000000', 2)
    unverified.asset.verified = false
    const [group] = groupTokens([verified, unverified])
    expect(group?.value).toBe(7)
    expect(group?.asset.verified).toBe(false)
    expect(group?.networks.find((network) => network.chainId === unverified.chainId)?.value).toBe(2)
    verified.holdings[0]!.value = null
    expect(groupTokens([verified])[0]?.priced).toBe(false)
  })

  it('collapses multiple implementations on one network to one icon and balance', () => {
    const a = row('eip155:1', 'zerion:usdc', 6, '1000000', 1)
    const b = { ...a, assetId: 'eip155:1/erc20:other-contract' }
    const [group] = groupTokens([a, b])
    expect(group?.networks).toHaveLength(1)
    expect(group?.networks[0]?.amount).toBe('2000000')
  })
})

describe('compact balances', () => {
  it('truncates large balances without converting base units to floats', () => {
    expect(compactBalance('1234999999999999999999999', 18)).toBe('1.23M')
    expect(compactBalance('999999999', 6)).toBe('')
    expect(compactBalance('1999999999', 6)).toBe('1.99K')
    expect(compactBalance('1000000000000000000000000000000000', 18)).toBe('>999T')
  })
})
