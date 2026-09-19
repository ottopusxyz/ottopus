import { describe, expect, it } from 'vitest'
import type { AssetRow, ChainRow } from '@/lib/api'
import { INTENT_PROMPTS, promptsFor, smallSlice } from './prompts'

const chains: ChainRow[] = [{ chainId: 'eip155:8453', name: 'Base', value: 1, share: 1 }]
const row = (symbol: string, decimals: number, amount: string, value: number): AssetRow => ({
  assetId: `eip155:8453/erc20:${symbol}`,
  chainId: 'eip155:8453',
  asset: { symbol, name: symbol, decimals, iconUrl: null, verified: true },
  amount,
  value,
  price: 1,
  change1d: 0,
  share: 1,
  holdings: [],
})

describe('a slice of a holding', () => {
  it('is about a twentieth, to two figures', () => {
    expect(smallSlice('1000000000', 6)).toBe('50')
    expect(smallSlice('1234000000000000000', 18)).toBe('0.062')
    expect(smallSlice('3', 18)).toBeNull()
    expect(smallSlice('x', 18)).toBeNull()
  })
})

describe('the prompts', () => {
  it('stand as the design wrote them without a reading', () => {
    expect(promptsFor(null)).toBe(INTENT_PROMPTS)
    expect(promptsFor({ assets: [], chains })).toBe(INTENT_PROMPTS)
  })

  it('lead with a swap out of the largest stable balance', () => {
    const prompts = promptsFor({ assets: [row('ETH', 18, '10000000000000000', 30), row('USDC', 6, '500000000', 500)], chains })
    expect(prompts[0]).toBe('Swap 20 USDC for ETH on Base')
    // Already the design's first prompt, so it is not listed twice.
    expect(prompts).toHaveLength(INTENT_PROMPTS.length)
  })

  it('lead with a small slice of anything else, into USDC', () => {
    const prompts = promptsFor({ assets: [row('ETH', 18, '1000000000000000000', 3000)], chains })
    expect(prompts[0]).toBe('Swap 0.05 ETH for USDC on Base')
    expect(prompts).toHaveLength(INTENT_PROMPTS.length + 1)
  })

  it('do not repeat a lead that is already on the list', () => {
    const prompts = promptsFor({ assets: [row('USDC', 6, '500000000', 500)], chains })
    expect(prompts.filter((p) => p === 'Swap 20 USDC for ETH on Base')).toHaveLength(1)
  })

  it('fall back when the chain has no name or the balance is dust', () => {
    expect(promptsFor({ assets: [row('USDC', 6, '500000000', 500)], chains: [] })).toBe(INTENT_PROMPTS)
    expect(promptsFor({ assets: [row('PEPE', 18, '3', 0.0001)], chains })).toBe(INTENT_PROMPTS)
  })
})
