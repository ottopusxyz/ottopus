import { describe, expect, it } from 'vitest'
import type { StockInfo, StockRegistry } from '../tokens/types.js'
import { stockNamed } from './stocks.js'
import type { AccountPosition, AccountRef, PortfolioConnector } from './types.js'

const BSC = 'eip155:56'
const NVDAB = `${BSC}/erc20:0x02fca66c1d1afb4e2a7884261eb00f63598a7436`
const PEPE = `${BSC}/erc20:0x2222222222222222222222222222222222222222`
/** A token calling itself NVDAB at some other address. */
const IMPOSTOR = `${BSC}/erc20:0x3333333333333333333333333333333333333333`
const BNB = `${BSC}/slip44:714`
const ARM: AccountRef = { namespace: 'eip155', address: '0xaa' }

function pos(assetId: string, symbol: string, over: Partial<AccountPosition['asset']> = {}): AccountPosition {
  return {
    assetId,
    chainId: BSC,
    asset: { symbol, name: symbol, decimals: 18, iconUrl: null, verified: false, ...over },
    positionType: 'wallet',
    amount: '1000000000000000000',
    value: 10,
    price: 10,
    change1d: 0,
    protocol: null,
    protocolModule: null,
    positionName: null,
    dappId: null,
    dappIconUrl: null,
    dappUrl: null,
    poolAddress: null,
    parentId: null,
    groupId: null,
  }
}

/** What the provider says: the bStock under the name it gives it, a plain token, an impostor, the chain's coin. */
const PROVIDED = [
  pos(NVDAB, 'N4B'),
  pos(PEPE, 'PEPE', { iconUrl: 'https://cdn/pepe.png', verified: true }),
  pos(IMPOSTOR, 'NVDAB'),
  pos(BNB, 'BNB', { verified: true }),
]

const NVDAB_INFO: StockInfo = {
  assetId: NVDAB,
  symbol: 'NVDAB',
  name: 'NVIDIA (bStocks)',
  decimals: 18,
  iconUrl: 'https://cdn/nvdab.png',
  priceUsd: 225,
  verified: true,
  stock: {
    platformId: 'bstock',
    ticker: 'NVDA',
    companyName: 'Nvidia Corp',
    tokenToShareRatio: 1,
    referencePriceUsd: 224.88,
    status: { open: true, marketStatus: null, reason: 'TRADING', nextOpenAt: null, nextCloseAt: null },
    asOf: '2026-09-25T10:00:00.000Z',
  },
}

function provider(): PortfolioConnector & { reads: string[] } {
  const reads: string[] = []
  return {
    reads,
    provider: 'zerion',
    async positionsFor(account) {
      reads.push(account.address)
      return PROVIDED
    },
    chainName: (chainId) => (chainId === BSC ? 'BNB Chain' : null),
    chainIcon: (chainId) => (chainId === BSC ? 'https://cdn/bsc.png' : null),
  }
}

/** A stock side that knows NVDAB by address and is down for whatever `down` names. */
function stocks(down: string[] = []): StockRegistry & { asked: string[] } {
  const asked: string[] = []
  return {
    asked,
    name: 'stocks',
    async stockOf(assetId) {
      asked.push(assetId)
      if (down.includes(assetId)) return { kind: 'unknown' }
      return assetId === NVDAB ? { kind: 'stock', info: NVDAB_INFO } : { kind: 'none' }
    },
    async variants() {
      return []
    },
  }
}

describe('naming held stock tokens from the stock registry', () => {
  it('gives a stock the registry’s words, icon and issuer, and leaves every other row the provider’s', async () => {
    const logged: string[] = []
    const registry = stocks()
    const named = stockNamed(provider(), registry, { log: (m) => logged.push(m) })
    const positions = await named.positionsFor(ARM)

    expect(positions[0]).toEqual({
      ...PROVIDED[0],
      asset: {
        symbol: 'NVDAB',
        name: 'NVIDIA (bStocks)',
        decimals: 18,
        iconUrl: 'https://cdn/nvdab.png',
        verified: true,
        stock: { issuer: 'bstock', ticker: 'NVDA' },
      },
    })
    expect(positions.slice(1)).toEqual(PROVIDED.slice(1))
    // Asked by asset id, which is by address: the impostor's symbol bought it nothing.
    expect(registry.asked).toEqual([NVDAB, PEPE, IMPOSTOR, BNB])
    expect(logged).toEqual([])
  })

  it('keeps the provider’s words through a registry miss, and says so once', async () => {
    const logged: string[] = []
    const named = stockNamed(provider(), stocks([NVDAB, PEPE]), { log: (m) => logged.push(m) })
    expect(await named.positionsFor(ARM)).toEqual(PROVIDED)
    expect(logged).toEqual([
      "[portfolio] stocks could not say whether 2 of 4 positions of eip155:0xaa are stocks; zerion's names stand for them",
    ])
  })

  it('forwards the provider’s name and chain words untouched', async () => {
    const named = stockNamed(provider(), stocks())
    expect(named.provider).toBe('zerion')
    expect(named.chainName?.(BSC)).toBe('BNB Chain')
    expect(named.chainIcon?.(BSC)).toBe('https://cdn/bsc.png')
    const bare = stockNamed({ provider: 'bare', positionsFor: async () => [] }, stocks())
    expect('chainName' in bare).toBe(false)
  })
})
