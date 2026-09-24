import { describe, expect, it } from 'vitest'
import { compositeTokens } from './composite.js'
import type { StockInfo, StockRegistry, TokenInfo, TokenRegistry } from './types.js'

const BSC = 'eip155:56'
const NVDAB = `${BSC}/erc20:0x02fca66c1d1afb4e2a7884261eb00f63598a7436`
const NVDAON = `${BSC}/erc20:0xa9ee28c80f960b889dfbd1902055218cba016f75`
const ETF = `${BSC}/erc20:0x1111111111111111111111111111111111111111`
const PEPE = `${BSC}/erc20:0x2222222222222222222222222222222222222222`

const stock = (symbol: string, platformId: string, assetId: string): StockInfo => ({
  assetId,
  symbol,
  name: `NVIDIA (${platformId})`,
  decimals: 18,
  iconUrl: null,
  priceUsd: 225,
  verified: true,
  stock: {
    platformId,
    ticker: 'NVDA',
    companyName: 'Nvidia Corp',
    tokenToShareRatio: 1,
    referencePriceUsd: 224.88,
    status: { open: true, marketStatus: null, reason: 'TRADING', nextOpenAt: null, nextCloseAt: null },
    asOf: '2026-09-24T10:00:00.000Z',
  },
})
const token = (symbol: string, assetId: string): TokenInfo => ({
  assetId,
  symbol,
  name: symbol,
  decimals: 18,
  iconUrl: null,
  priceUsd: 1,
  verified: false,
})

const VARIANTS = [stock('NVDAon', 'ondo', NVDAON), stock('NVDAB', 'bstock', NVDAB)]

/** What the stock side says per query, and a log of what it was asked. */
function stocks(answers: Record<string, StockInfo[] | null>) {
  const asked: string[] = []
  const registry: StockRegistry = {
    name: 'stocks',
    async byAssetId(assetId) {
      asked.push(`by:${assetId}`)
      return VARIANTS.find((v) => v.assetId === assetId) ?? null
    },
    async variants(_chain, query) {
      asked.push(`variants:${query}`)
      return query in answers ? answers[query]! : []
    },
  }
  return { asked, registry }
}

/** The general registry, which answers a stock symbol with the wrong token. */
function general() {
  const asked: string[] = []
  const registry: TokenRegistry = {
    name: 'general',
    async byAssetId(assetId) {
      asked.push(`by:${assetId}`)
      return assetId === PEPE ? token('PEPE', PEPE) : assetId === NVDAB ? token('N4B', NVDAB) : null
    },
    async find(_chain, query) {
      asked.push(`find:${query}`)
      if (query === 'PEPE') return token('PEPE', PEPE)
      if (query === 'NVDAB' || query === 'NVDA') return token('NVDA2S', ETF)
      return null
    },
  }
  return { asked, registry }
}

describe('the composite registry', () => {
  it('lets the stock side answer a stock symbol, and never asks the general one', async () => {
    const s = stocks({ NVDAB: [VARIANTS[1]!] })
    const g = general()
    const registry = compositeTokens({ stocks: s.registry, tokens: g.registry })
    expect(await registry.find(BSC, 'NVDAB')).toMatchObject({ assetId: NVDAB, symbol: 'NVDAB' })
    expect(g.asked).toEqual([])
  })

  /** The general registry would answer "NVDA" with an ETF. It is not asked. */
  it('answers nothing for a ticker with several variants, rather than letting the general side pick', async () => {
    const s = stocks({ NVDA: VARIANTS })
    const g = general()
    const registry = compositeTokens({ stocks: s.registry, tokens: g.registry })
    expect(await registry.find(BSC, 'NVDA')).toBeNull()
    expect(g.asked).toEqual([])
  })

  it('falls through to the general registry for a token that is not a stock', async () => {
    const s = stocks({})
    const g = general()
    const registry = compositeTokens({ stocks: s.registry, tokens: g.registry })
    expect(await registry.find(BSC, 'PEPE')).toMatchObject({ symbol: 'PEPE' })
    expect(await registry.byAssetId(PEPE)).toMatchObject({ symbol: 'PEPE' })
    expect(g.asked).toEqual(['find:PEPE', `by:${PEPE}`])
  })

  /** A stock's metadata comes from the stock side, with the stock facts on it. */
  it('answers a stock address with the stock facts, not the general registry’s name for it', async () => {
    const s = stocks({})
    const g = general()
    const registry = compositeTokens({ stocks: s.registry, tokens: g.registry })
    expect(await registry.byAssetId(NVDAB)).toMatchObject({ symbol: 'NVDAB', stock: { platformId: 'bstock' } })
    expect(g.asked).toEqual([])
  })

  /** A vendor outage on the stock side reads as "not a stock": the general side still answers. */
  it('falls through when the stock side could not answer at all', async () => {
    const s = stocks({ PEPE: null })
    const g = general()
    const registry = compositeTokens({ stocks: s.registry, tokens: g.registry })
    expect(await registry.find(BSC, 'PEPE')).toMatchObject({ symbol: 'PEPE' })
  })

  it('works with either side missing', async () => {
    const g = general()
    const onlyGeneral = compositeTokens({ stocks: null, tokens: g.registry })
    expect(await onlyGeneral.find(BSC, 'PEPE')).toMatchObject({ symbol: 'PEPE' })

    const s = stocks({ NVDAB: [VARIANTS[1]!] })
    const onlyStocks = compositeTokens({ stocks: s.registry, tokens: null })
    expect(await onlyStocks.find(BSC, 'NVDAB')).toMatchObject({ symbol: 'NVDAB' })
    expect(await onlyStocks.find(BSC, 'PEPE')).toBeNull()
    expect(onlyStocks.name).toBe('stocks')
  })
})
