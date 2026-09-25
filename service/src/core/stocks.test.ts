import { describe, expect, it } from 'vitest'
import { decimalString, effectiveStockPrice } from './stocks.js'

const USDC = { decimals: 6, symbol: 'USDC', priceUsd: 1 }
const NVDAB = 18

describe('effectiveStockPrice', () => {
  it('prices a buy per share from what was paid, against the reference', () => {
    // 500 USDC for 2.2 NVDAB: $227.27 a share, 1.4% over a $224.13 reference.
    const got = effectiveStockPrice({
      role: 'to',
      tokens: { amount: '2200000000000000000', decimals: NVDAB },
      tokenToShareRatio: 1,
      counter: { amount: '500000000', ...USDC },
      referencePriceUsd: 224.13,
    })
    expect(got).toEqual({
      counterSymbol: 'USDC',
      counterPriceUsd: '1',
      shares: '2.2',
      valueUsd: '500',
      priceUsd: '227.27272727',
      premiumBps: 140,
    })
  })

  it('reads a discount as a negative premium', () => {
    const got = effectiveStockPrice({
      role: 'to',
      tokens: { amount: '2300000000000000000', decimals: NVDAB },
      tokenToShareRatio: 1,
      counter: { amount: '500000000', ...USDC },
      referencePriceUsd: 224.13,
    })
    expect(got?.priceUsd).toBe('217.39130435')
    expect(got?.premiumBps).toBe(-301)
  })

  it('prices a sell per share from what arrives', () => {
    // 2 NVDAB sold for 440 USDC: $220 a share, 1.8% under the reference.
    const got = effectiveStockPrice({
      role: 'from',
      tokens: { amount: '2000000000000000000', decimals: NVDAB },
      tokenToShareRatio: 1,
      counter: { amount: '440000000', ...USDC },
      referencePriceUsd: 224.13,
    })
    expect(got).toMatchObject({ shares: '2', valueUsd: '440', priceUsd: '220', premiumBps: -184 })
  })

  it('counts shares through the ratio, so a drifted token is not a premium', () => {
    // 1.02 shares per token: 2 tokens are 2.04 shares, and $457.23 for them is par.
    const got = effectiveStockPrice({
      role: 'to',
      tokens: { amount: '2000000000000000000', decimals: NVDAB },
      tokenToShareRatio: 1.02,
      counter: { amount: '457225200', ...USDC },
      referencePriceUsd: 224.13,
    })
    expect(got).toMatchObject({ shares: '2.04', priceUsd: '224.13', premiumBps: 0 })
  })

  it('prices through a counter asset that is not a dollar', () => {
    // 0.5 BNB at $900 for 2 shares: $225 a share.
    const got = effectiveStockPrice({
      role: 'to',
      tokens: { amount: '2000000000000000000', decimals: NVDAB },
      tokenToShareRatio: 1,
      counter: { amount: '500000000000000000', decimals: 18, symbol: 'BNB', priceUsd: 900 },
      referencePriceUsd: 224.13,
    })
    expect(got).toMatchObject({ counterSymbol: 'BNB', counterPriceUsd: '900', valueUsd: '450', priceUsd: '225', premiumBps: 39 })
  })

  it('gives a price but no premium without a reference', () => {
    const got = effectiveStockPrice({
      role: 'to',
      tokens: { amount: '2000000000000000000', decimals: NVDAB },
      tokenToShareRatio: 1,
      counter: { amount: '450000000', ...USDC },
      referencePriceUsd: null,
    })
    expect(got).toMatchObject({ priceUsd: '225', premiumBps: null })
  })

  it('is null without a counter price, or with nothing moving', () => {
    const base = {
      role: 'to' as const,
      tokens: { amount: '2000000000000000000', decimals: NVDAB },
      tokenToShareRatio: 1,
      referencePriceUsd: 224.13,
    }
    expect(effectiveStockPrice({ ...base, counter: { amount: '450000000', decimals: 6, symbol: 'USDC', priceUsd: null } })).toBeNull()
    expect(effectiveStockPrice({ ...base, counter: { amount: '0', ...USDC } })).toBeNull()
    expect(effectiveStockPrice({ ...base, tokens: { amount: '0', decimals: NVDAB }, counter: { amount: '450000000', ...USDC } })).toBeNull()
  })
})

describe('decimalString', () => {
  it('writes eight places at most, drops trailing zeros, and never uses exponents', () => {
    expect(decimalString(224.13)).toBe('224.13')
    expect(decimalString(1)).toBe('1')
    expect(decimalString(1.000778221)).toBe('1.00077822')
    expect(decimalString(1e-9)).toBe('0')
    expect(decimalString(-0.000000001)).toBe('0')
    expect(decimalString(1e21)).toBe('1000000000000000000000')
  })
})
