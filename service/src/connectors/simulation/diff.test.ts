import { ethAddress } from 'viem'
import { describe, expect, it } from 'vitest'
import { deltasFrom, resultHashOf, type RawAssetChange } from './diff.js'

const BASE = 'eip155:8453'
const BNB = 'eip155:56'
const USDC = '0x833589FCD6EDb6E08f4c7C32D4f71b54bdA02913'

const change = (address: string, pre: bigint, post: bigint, over: Partial<RawAssetChange['token']> = {}): RawAssetChange => ({
  token: { address, ...over },
  value: { pre, post, diff: post - pre },
})

describe('turning traced balances into plan rows', () => {
  it('names the chain’s own currency from the registry, not from the simulator', () => {
    // viem reports every native balance as "ETH", 18 decimals. On BNB Chain
    // that is the wrong currency with the right number of zeros, and the
    // review page would tell someone they are sending ETH.
    const [row] = deltasFrom([change(ethAddress, 1_000n, 0n, { symbol: 'ETH', decimals: 18 })], BNB)
    expect(row).toMatchObject({ assetId: `${BNB}/slip44:714`, symbol: 'BNB', decimals: 18, diff: '-1000' })
  })

  it('keeps ETH where ETH is right', () => {
    const [row] = deltasFrom([change(ethAddress, 5n, 4n)], BASE)
    expect(row).toMatchObject({ assetId: `${BASE}/slip44:60`, symbol: 'ETH' })
  })

  it('reads the zero address as native too', () => {
    const [row] = deltasFrom([change('0x0000000000000000000000000000000000000000', 5n, 4n)], BASE)
    expect(row?.assetId).toBe(`${BASE}/slip44:60`)
  })

  it('lowercases a token into its CAIP-19 id and keeps the simulator’s words for it', () => {
    const [row] = deltasFrom([change(USDC, 1_000_000n, 500_000n, { symbol: 'USDC', decimals: 6 })], BASE)
    expect(row).toMatchObject({
      assetId: `${BASE}/erc20:${USDC.toLowerCase()}`,
      symbol: 'USDC',
      decimals: 6,
      diff: '-500000',
      pre: '1000000',
      post: '500000',
    })
  })

  it('carries an unlabelled token as a row with no words rather than dropping it', () => {
    const [row] = deltasFrom([change('0x1111111111111111111111111111111111111111', 2n, 1n)], BASE)
    expect(row).toMatchObject({ symbol: null, decimals: null, diff: '-1' })
  })

  it('drops a balance that did not move', () => {
    expect(deltasFrom([change(USDC, 7n, 7n, { symbol: 'USDC', decimals: 6 })], BASE)).toEqual([])
  })

  it('still names the currency of an ETH chain the SLIP-44 table has never heard of', () => {
    // The registry falls back to coin type 60 for a chain whose currency is
    // ETH, which is every rollup that ships after this table was written.
    // Dropping the row would lose the only line the page has.
    const [row] = deltasFrom([change(ethAddress, 5n, 4n)], 'eip155:11155111')
    expect(row).toMatchObject({ assetId: 'eip155:11155111/slip44:60', symbol: 'ETH' })
  })

  it('puts the biggest movement first, and what leaves before what arrives', () => {
    const rows = deltasFrom(
      [
        change(USDC, 0n, 5n, { symbol: 'USDC', decimals: 6 }),
        change('0x2222222222222222222222222222222222222222', 100n, 0n, { symbol: 'WETH', decimals: 18 }),
        change('0x3333333333333333333333333333333333333333', 0n, 5n, { symbol: 'DAI', decimals: 18 }),
        change(ethAddress, 5n, 0n),
      ],
      BASE,
    )
    expect(rows.map((r) => `${r.symbol}:${r.diff}`)).toEqual(['WETH:-100', 'ETH:-5', 'DAI:5', 'USDC:5'])
  })
})

describe('the result hash', () => {
  const conclusions = {
    chainId: BASE,
    blockNumber: '51119499',
    success: true,
    gasUsed: '44831',
    assetChanges: deltasFrom([change(USDC, 1n, 0n, { symbol: 'USDC', decimals: 6 })], BASE),
  }

  it('is the same for the same conclusions', () => {
    expect(resultHashOf(conclusions)).toBe(resultHashOf({ ...conclusions }))
    expect(resultHashOf(conclusions)).toMatch(/^[0-9a-f]{64}$/)
  })

  it('changes when any conclusion changes', () => {
    const base = resultHashOf(conclusions)
    expect(resultHashOf({ ...conclusions, gasUsed: '44832' })).not.toBe(base)
    expect(resultHashOf({ ...conclusions, success: false })).not.toBe(base)
    expect(resultHashOf({ ...conclusions, blockNumber: '51119500' })).not.toBe(base)
    expect(resultHashOf({ ...conclusions, assetChanges: [] })).not.toBe(base)
  })
})
