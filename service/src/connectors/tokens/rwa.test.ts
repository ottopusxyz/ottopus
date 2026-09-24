import { describe, expect, it } from 'vitest'
import { BinanceClient } from '../binance/index.js'
import { rwaTokens } from './rwa.js'

const BSC = 'eip155:56'
const ETHEREUM = 'eip155:1'
const NVDAB = '0x02fca66c1d1afb4e2a7884261eb00f63598a7436'
const NVDAON = '0xa9ee28c80f960b889dfbd1902055218cba016f75'
const NVDAON_ETH = '0x2d1f7226bd1f780af6b9a49dcc0ae00e8df4bdee'
const AAPLB = '0x431a3bee82e2ca41e49895cbece5bb0f76a89b7a'

/** Recorded 2026-09-24. `search` answers every chain, whatever chain filter is sent. */
const SEARCH_NVDA = [
  {
    ticker: 'NVDA',
    companyName: 'Nvidia Corp',
    assets: [
      { platformId: 'ondo', binanceChainId: '56', tokenContractAddress: NVDAON, tokenSymbol: 'NVDAon', assetType: 1 },
      { platformId: 'ondo', binanceChainId: 'CT_501', tokenContractAddress: 'gEGtLTPNQ7jcg25zTetkbmF7teoDLcrfTnQfmn2ondo', tokenSymbol: 'NVDAon', assetType: 1 },
      { platformId: 'ondo', binanceChainId: '1', tokenContractAddress: NVDAON_ETH, tokenSymbol: 'NVDAon', assetType: 1 },
      { platformId: 'bstock', binanceChainId: '56', tokenContractAddress: NVDAB, tokenSymbol: 'NVDAB', assetType: 1 },
    ],
  },
]

/** The vendor narrows an exact token symbol itself. */
const SEARCH_NVDAB = [
  {
    ticker: 'NVDA',
    companyName: 'Nvidia Corp',
    assets: [{ platformId: 'bstock', binanceChainId: '56', tokenContractAddress: NVDAB, tokenSymbol: 'NVDAB', assetType: 1 }],
  },
]

/** A loose match: "A" returned twenty-three tickers. Two of them here. */
const SEARCH_LOOSE = [
  ...SEARCH_NVDA,
  {
    ticker: 'AAPL',
    companyName: 'Apple Inc.',
    assets: [{ platformId: 'bstock', binanceChainId: '56', tokenContractAddress: AAPLB, tokenSymbol: 'AAPLB', assetType: 1 }],
  },
]

/** Recorded 2026-09-24 from `tokens?binanceChainId=56`, trimmed to three of 488 rows. */
const TOKENS_BSC = [
  {
    binanceChainId: '56',
    tokenContractAddress: NVDAON,
    platformId: 'ondo',
    assetType: 1,
    tokenName: 'NVIDIA (Ondo)',
    tokenSymbol: 'NVDAon',
    tokenLogoUrl: 'https://onchainos.bnbstatic.com/images/web3-data/public/token/logos/4357.png',
    decimals: '18',
    underlyingTicker: 'NVDA',
    underlyingName: 'Nvidia Corp',
    underlyingNameZh: '英伟达',
    tokenToShareRatio: '1.0017152487959898',
    tags: ['alpha'],
    statusInfo: {
      openState: true,
      marketStatus: 'overnight',
      reasonCode: 'TRADING',
      reasonMsg: null,
      nextOpenTime: 1790236860000,
      nextCloseTime: 1790236500000,
    },
    tokenPrice: '225.642077578685502673846328146752',
    referencePrice: '225.25570799675424',
    volume24H: '20136957436.822414',
    marketCap: '5445309488049',
    peRatioTTM: '27.83',
  },
  {
    binanceChainId: '56',
    tokenContractAddress: NVDAB,
    platformId: 'bstock',
    assetType: 1,
    tokenName: 'NVIDIA (bStocks)',
    tokenSymbol: 'NVDAB',
    tokenLogoUrl: 'https://onchainos.bnbstatic.com/images/web3-data/public/token/logos/9dc0.png',
    decimals: '18',
    underlyingTicker: 'NVDA',
    underlyingName: 'Nvidia Corp',
    underlyingNameZh: '英伟达',
    tokenToShareRatio: '1.000778223752807865',
    tags: ['alpha'],
    statusInfo: { openState: true, marketStatus: null, reasonCode: 'TRADING', reasonMsg: null, nextOpenTime: null, nextCloseTime: null },
    tokenPrice: '225.0550069575314326812',
    referencePrice: '224.88',
    volume24H: '16176619971',
    marketCap: '5526523890000',
    peRatioTTM: '28.47',
  },
  {
    binanceChainId: '56',
    tokenContractAddress: AAPLB,
    platformId: 'bstock',
    assetType: 1,
    tokenName: 'Apple (bStocks)',
    tokenSymbol: 'AAPLB',
    tokenLogoUrl: 'https://onchainos.bnbstatic.com/images/web3-data/public/token/logos/aapl.png',
    decimals: '18',
    underlyingTicker: 'AAPL',
    underlyingName: 'Apple Inc.',
    underlyingNameZh: 'Apple Inc.',
    tokenToShareRatio: '1.000000000000000000',
    tags: null,
    statusInfo: {
      openState: false,
      marketStatus: 'paused',
      reasonCode: 'MARKET_PAUSED',
      reasonMsg: 'Paused for session transition',
      nextOpenTime: 1790256660000,
      nextCloseTime: 1790279940000,
    },
    tokenPrice: '190.31',
    referencePrice: '190.31',
    volume24H: '59486',
    marketCap: '2800000000000',
    peRatioTTM: '29.1',
  },
]

type Route = { status?: number; body?: unknown }

const ok = (data: unknown): Route => ({ body: { code: 0, msg: 'success', data, success: true } })
/** What the vendor says when a search matches nothing: a refusal with its own code. */
const noMatch = (keyword: string): Route => ({
  body: { code: 40382, msg: `No matching RWA assets found for keyword: ${keyword}`, data: null },
})
const outage: Route = { status: 502, body: { code: 50000, msg: 'upstream' } }

/** A fake vendor keyed by path and query, recording every request. */
function vendor(routes: Record<string, Route>, at = { now: 1_000_000 }) {
  const seen: string[] = []
  const doFetch = (async (url: unknown) => {
    const path = String(url).replace('https://web3.binance.com/build', '')
    seen.push(path)
    const route = routes[path] ?? { status: 404, body: { code: 40400, msg: 'not found' } }
    return new Response(JSON.stringify(route.body ?? {}), {
      status: route.status ?? 200,
      headers: { 'content-type': 'application/json' },
    })
  }) as unknown as typeof fetch
  const client = new BinanceClient({ apiKey: 'k', secretKey: 's', fetch: doFetch, now: () => at.now })
  const registry = rwaTokens({ client, now: () => at.now })
  return { seen, registry, at }
}

const search = (keyword: string) => `/api/v1/dex/market/rwa/search?keyword=${encodeURIComponent(keyword)}`
const tokens = (chain: string) => `/api/v1/dex/market/rwa/tokens?binanceChainId=${chain}`

const bsc = (over: Record<string, Route> = {}) =>
  vendor({ [search('NVDA')]: ok(SEARCH_NVDA), [search('NVDAB')]: ok(SEARCH_NVDAB), [tokens('56')]: ok(TOKENS_BSC), ...over })

describe('the RWA registry', () => {
  it('answers a ticker with every provider variant on the chain, never a pick', async () => {
    const { registry } = bsc()
    const found = await registry.variants(BSC, 'NVDA')

    expect(found?.map((v) => [v.symbol, v.stock.platformId, v.assetId])).toEqual([
      ['NVDAon', 'ondo', `${BSC}/erc20:${NVDAON}`],
      ['NVDAB', 'bstock', `${BSC}/erc20:${NVDAB}`],
    ])
    expect(found?.[1]).toMatchObject({
      name: 'NVIDIA (bStocks)',
      decimals: 18,
      iconUrl: 'https://onchainos.bnbstatic.com/images/web3-data/public/token/logos/9dc0.png',
      priceUsd: 225.05500695753145,
      verified: true,
      stock: {
        ticker: 'NVDA',
        companyName: 'Nvidia Corp',
        tokenToShareRatio: 1.0007782237528078,
        referencePriceUsd: 224.88,
        status: { open: true, marketStatus: null, reason: 'TRADING', nextOpenAt: null, nextCloseAt: null },
        asOf: '1970-01-01T00:16:40.000Z',
      },
    })
  })

  it('reads the market status, with the vendor’s epoch times as ISO', async () => {
    const { registry } = bsc({ [search('AAPLB')]: ok([SEARCH_LOOSE[1]]) })
    const [aapl] = (await registry.variants(BSC, 'AAPLB')) ?? []
    expect(aapl?.stock.status).toEqual({
      open: false,
      marketStatus: 'paused',
      reason: 'MARKET_PAUSED',
      nextOpenAt: '2026-09-24T13:31:00.000Z',
      nextCloseAt: '2026-09-24T19:59:00.000Z',
    })
  })

  /**
   * The search answers across chains and the list is per chain. The Solana
   * row is not ours, and the Ethereum row has no list entry, so a lookup on
   * Ethereum answers "none" and the general registry gets its turn.
   */
  it('keeps to the chain asked about, and drops a variant the list has no row for', async () => {
    const { registry } = bsc({ [tokens('1')]: ok([]) })
    expect(await registry.variants(ETHEREUM, 'NVDA')).toEqual([])
  })

  it('answers the address of a stock token with its metadata', async () => {
    const { registry, seen } = bsc()
    const found = await registry.byAssetId(`${BSC}/erc20:${NVDAB.toUpperCase().replace('0X', '0x')}`)
    expect(found).toMatchObject({ symbol: 'NVDAB', stock: { platformId: 'bstock' } })
    // The address filter is ignored by the vendor, so the list is the source.
    expect(seen).toEqual([tokens('56')])
    expect(await registry.byAssetId(`${BSC}/erc20:0x000000000000000000000000000000000000dead`)).toBeNull()
    expect(await registry.byAssetId(`${BSC}/slip44:60`)).toBeNull()
  })

  it('finds one token for an exact symbol or an address, and none for a bare ticker', async () => {
    const { registry } = bsc()
    expect(await registry.find(BSC, 'NVDAB')).toMatchObject({ assetId: `${BSC}/erc20:${NVDAB}` })
    expect(await registry.find(BSC, NVDAB)).toMatchObject({ symbol: 'NVDAB' })
    expect(await registry.find(BSC, 'NVDA')).toBeNull()
  })

  /** "A" matched twenty-three tickers on the real vendor. An exact ticker means that one. */
  it('narrows a loose match to the exact ticker or symbol when the query is one', async () => {
    const { registry } = bsc({ [search('nvda')]: ok(SEARCH_LOOSE), [search('Nvidia')]: ok(SEARCH_LOOSE) })
    expect((await registry.variants(BSC, 'nvda'))?.map((v) => v.symbol)).toEqual(['NVDAon', 'NVDAB'])
    expect((await registry.variants(BSC, 'Nvidia'))?.map((v) => v.symbol)).toEqual(['NVDAon', 'NVDAB', 'AAPLB'])
  })

  it('answers "none" for a token that is not a stock, and remembers it', async () => {
    const { registry, seen } = bsc({ [search('PEPE')]: noMatch('PEPE') })
    expect(await registry.variants(BSC, 'PEPE')).toEqual([])
    expect(await registry.variants(BSC, 'pepe')).toEqual([])
    expect(seen.filter((p) => p.includes('PEPE') || p.includes('pepe'))).toHaveLength(1)
  })

  it('does not remember a vendor failure as an absence', async () => {
    const { registry, seen } = bsc({ [search('NVDA')]: outage })
    expect(await registry.variants(BSC, 'NVDA')).toBeNull()
    expect(await registry.variants(BSC, 'NVDA')).toBeNull()
    expect(seen.filter((p) => p.startsWith(search('NVDA')))).toHaveLength(2)
  })

  it('answers "none" on a chain the vendor does not speak for', async () => {
    const { registry, seen } = bsc()
    expect(await registry.variants('solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp', 'NVDA')).toEqual([])
    expect(seen).toEqual([])
  })

  it('keeps a search for a day, and fetches the list once per burst', async () => {
    const { registry, seen, at } = bsc()
    await Promise.all([registry.variants(BSC, 'NVDA'), registry.variants(BSC, 'NVDA'), registry.byAssetId(`${BSC}/erc20:${NVDAB}`)])
    expect(seen).toEqual([search('NVDA'), tokens('56')])

    at.now += 23 * 60 * 60_000
    await registry.variants(BSC, 'NVDA')
    expect(seen.filter((p) => p.startsWith(search('NVDA')))).toHaveLength(1)
    at.now += 2 * 60 * 60_000
    await registry.variants(BSC, 'NVDA')
    expect(seen.filter((p) => p.startsWith(search('NVDA')))).toHaveLength(2)
  })

  /** Status and prices live on the list, so it is read again within the minute, and served stale when the vendor is down. */
  it('refreshes the list on a short clock and serves it stale through an outage', async () => {
    const routes = { [search('NVDA')]: ok(SEARCH_NVDA), [tokens('56')]: ok(TOKENS_BSC) }
    const { registry, seen, at } = vendor(routes)
    await registry.variants(BSC, 'NVDA')
    at.now += 30_000
    await registry.variants(BSC, 'NVDA')
    expect(seen.filter((p) => p === tokens('56'))).toHaveLength(1)

    at.now += 60_000
    routes[tokens('56')] = outage
    const found = await registry.variants(BSC, 'NVDA')
    expect(seen.filter((p) => p === tokens('56'))).toHaveLength(2)
    expect(found?.map((v) => v.symbol)).toEqual(['NVDAon', 'NVDAB'])
    expect(found?.[0]?.stock.asOf).toBe('1970-01-01T00:16:40.000Z')
  })
})
