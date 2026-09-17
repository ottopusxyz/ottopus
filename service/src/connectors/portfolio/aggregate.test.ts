import { describe, expect, it, vi } from 'vitest'
import { readPortfolio, type ArmRef } from './aggregate.js'
import {
  PortfolioError,
  type AccountPosition,
  type AccountRef,
  type PortfolioConnector,
  type PositionType,
} from './types.js'

const ETH_BASE = 'eip155:8453/slip44:60'
const USDC_BASE = 'eip155:8453/erc20:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913'
const USDC_MAINNET = 'eip155:1/erc20:0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48'

const DAILY: ArmRef = { walletId: 'w-daily', namespace: 'eip155', address: '0xaa' }
const VAULT: ArmRef = { walletId: 'w-vault', namespace: 'eip155', address: '0xbb' }

interface PositionInput {
  assetId?: string
  chainId?: string
  symbol?: string
  decimals?: number
  amount?: string
  value?: number | null
  price?: number | null
  change1d?: number | null
  positionType?: PositionType
  protocol?: string | null
  groupId?: string | null
}

function pos(input: PositionInput = {}): AccountPosition {
  const assetId = input.assetId ?? USDC_BASE
  return {
    assetId,
    chainId: input.chainId ?? assetId.split('/')[0]!,
    asset: {
      symbol: input.symbol ?? 'USDC',
      name: input.symbol ?? 'USD Coin',
      decimals: input.decimals ?? 6,
      iconUrl: null,
      verified: true,
    },
    positionType: input.positionType ?? 'wallet',
    amount: input.amount ?? '1000000',
    value: input.value === undefined ? 1 : input.value,
    price: input.price === undefined ? 1 : input.price,
    change1d: input.change1d === undefined ? 0 : input.change1d,
    protocol: input.protocol ?? null,
    groupId: input.groupId ?? null,
  }
}

/** A connector whose answers are scripted per address. */
function fake(
  byAddress: Record<string, AccountPosition[] | PortfolioError>,
  chainNames: Record<string, string> = {},
): PortfolioConnector {
  return {
    provider: 'fake',
    positionsFor: vi.fn(async (account: AccountRef) => {
      const answer = byAddress[account.address]
      if (answer instanceof PortfolioError) throw answer
      return answer ?? []
    }),
    chainName: (chainId: string) => chainNames[chainId] ?? null,
  }
}

describe('merging the same asset across arms', () => {
  it('adds base units as BigInt, not as floats', async () => {
    // Two ETH balances whose sum is past Number.MAX_SAFE_INTEGER. Added as
    // floats these round, and the result is a balance a plan would sign against.
    const portfolio = await readPortfolio(
      fake({
        '0xaa': [pos({ assetId: ETH_BASE, symbol: 'ETH', decimals: 18, amount: '9007199254740993', value: 20 })],
        '0xbb': [pos({ assetId: ETH_BASE, symbol: 'ETH', decimals: 18, amount: '9007199254740993', value: 20 })],
      }),
      [DAILY, VAULT],
    )

    expect(portfolio.assets).toHaveLength(1)
    expect(portfolio.assets[0]!.amount).toBe('18014398509481986')
  })

  it('keeps one row per asset per chain, never merging across chains', async () => {
    const portfolio = await readPortfolio(
      fake({
        '0xaa': [pos({ assetId: USDC_BASE }), pos({ assetId: USDC_MAINNET, chainId: 'eip155:1' })],
      }),
      [DAILY],
    )

    expect(portfolio.assets.map((a) => a.assetId).sort()).toEqual([USDC_MAINNET, USDC_BASE].sort())
  })

  it('records which arm holds what, so the wallets view has something to show', async () => {
    const portfolio = await readPortfolio(
      fake({
        '0xaa': [pos({ amount: '1000000', value: 1 })],
        '0xbb': [pos({ amount: '3000000', value: 3 })],
      }),
      [DAILY, VAULT],
    )

    const row = portfolio.assets[0]!
    expect(row.amount).toBe('4000000')
    expect(row.holdings).toEqual([
      { walletId: 'w-daily', positionType: 'wallet', amount: '1000000', value: 1, protocol: null, groupId: null },
      { walletId: 'w-vault', positionType: 'wallet', amount: '3000000', value: 3, protocol: null, groupId: null },
    ])
  })

  it('takes a price from a later arm when the first had none', async () => {
    const portfolio = await readPortfolio(
      fake({
        '0xaa': [pos({ price: null, value: null })],
        '0xbb': [pos({ price: 1.0001 })],
      }),
      [DAILY, VAULT],
    )
    expect(portfolio.assets[0]!.price).toBe(1.0001)
  })
})

describe('what counts as spendable', () => {
  it('separates a loose balance from the same token staked', async () => {
    const portfolio = await readPortfolio(
      fake({
        '0xaa': [
          pos({ amount: '1000000', value: 1 }),
          pos({ amount: '9000000', value: 9, positionType: 'deposit', protocol: 'Aave V3' }),
        ],
      }),
      [DAILY],
    )

    const row = portfolio.assets[0]!
    expect(row.amount).toBe('10000000')
    expect(row.spendable).toBe('1000000')
    expect(row.value).toBe(10)
  })

  it('counts nothing as spendable when every holding is in a protocol', async () => {
    const portfolio = await readPortfolio(
      fake({ '0xaa': [pos({ positionType: 'staked', protocol: 'Lido', amount: '5000000' })] }),
      [DAILY],
    )
    expect(portfolio.assets[0]!.spendable).toBe('0')
  })
})

describe('debt reduces the total, and shares stay honest about it', () => {
  it('subtracts a loan from the total', async () => {
    const portfolio = await readPortfolio(
      fake({
        '0xaa': [
          pos({ assetId: ETH_BASE, symbol: 'ETH', decimals: 18, amount: '1000000000000000000', value: 3000 }),
          pos({ amount: '500000000', value: -500, positionType: 'loan', protocol: 'Aave V3' }),
        ],
      }),
      [DAILY],
    )

    expect(portfolio.total).toBe(2500)
    // Gross is what is held; the loan is not part of it.
    expect(portfolio.gross).toBe(3000)
  })

  it('never lets a share exceed 100% because of a loan', async () => {
    const portfolio = await readPortfolio(
      fake({
        '0xaa': [
          pos({ assetId: ETH_BASE, symbol: 'ETH', decimals: 18, amount: '1', value: 1000 }),
          pos({ amount: '1', value: -900, positionType: 'loan', protocol: 'Aave V3' }),
        ],
      }),
      [DAILY],
    )

    const shares = portfolio.assets.map((a) => a.share)
    expect(Math.max(...shares)).toBeLessThanOrEqual(1)
    // The debt row has no share of holdings — it is not a holding.
    expect(portfolio.assets.find((a) => a.value < 0)!.share).toBe(0)
  })
})

describe('one failed arm is not a failed portfolio', () => {
  it('keeps the arms that answered and says why the other did not', async () => {
    const portfolio = await readPortfolio(
      fake({
        '0xaa': [pos({ amount: '2000000', value: 2 })],
        '0xbb': new PortfolioError('untracked_address', 'not trackable'),
      }),
      [DAILY, VAULT],
    )

    expect(portfolio.total).toBe(2)
    expect(portfolio.assets).toHaveLength(1)
    expect(portfolio.arms).toEqual([
      { walletId: 'w-daily', address: '0xaa', status: 'ok', total: 2, change1d: 0, positionCount: 1 },
      { walletId: 'w-vault', address: '0xbb', status: 'untracked_address', total: 0, change1d: 0, positionCount: 0 },
    ])
  })

  it('reports an error that is not a PortfolioError as an outage', async () => {
    const connector: PortfolioConnector = {
      provider: 'fake',
      positionsFor: async () => {
        throw new TypeError('fetch failed')
      },
    }
    const portfolio = await readPortfolio(connector, [DAILY])
    expect(portfolio.arms[0]!.status).toBe('unavailable')
  })

  it('reads every arm in parallel rather than one after another', async () => {
    let inFlight = 0
    let peak = 0
    const connector: PortfolioConnector = {
      provider: 'fake',
      positionsFor: async () => {
        peak = Math.max(peak, ++inFlight)
        await new Promise((r) => setTimeout(r, 5))
        inFlight--
        return []
      },
    }

    await readPortfolio(connector, [DAILY, VAULT, { ...DAILY, walletId: 'w-3', address: '0xcc' }])
    expect(peak).toBe(3)
  })
})

describe('the totals a page renders', () => {
  it('makes the header total the sum of the visible rows', async () => {
    const portfolio = await readPortfolio(
      fake({
        '0xaa': [
          pos({ assetId: ETH_BASE, symbol: 'ETH', decimals: 18, amount: '1', value: 900, change1d: 12 }),
          pos({ amount: '100000000', value: 100, change1d: -2 }),
        ],
        '0xbb': [pos({ amount: '500000000', value: 500, change1d: 1 })],
      }),
      [DAILY, VAULT],
    )

    const sum = portfolio.assets.reduce((n, a) => n + a.value, 0)
    expect(portfolio.total).toBe(sum)
    expect(portfolio.total).toBe(1500)
    expect(portfolio.change1d).toBe(11)
  })

  it('sorts rows by value, biggest first', async () => {
    const portfolio = await readPortfolio(
      fake({
        '0xaa': [
          pos({ amount: '1', value: 5 }),
          pos({ assetId: ETH_BASE, symbol: 'ETH', decimals: 18, amount: '1', value: 900 }),
          pos({ assetId: USDC_MAINNET, chainId: 'eip155:1', amount: '1', value: 40 }),
        ],
      }),
      [DAILY],
    )
    expect(portfolio.assets.map((a) => a.value)).toEqual([900, 40, 5])
  })

  it('breaks the total down by chain, with the provider’s name for each', async () => {
    const portfolio = await readPortfolio(
      fake(
        {
          '0xaa': [
            pos({ assetId: ETH_BASE, symbol: 'ETH', decimals: 18, amount: '1', value: 750 }),
            pos({ assetId: USDC_MAINNET, chainId: 'eip155:1', amount: '1', value: 250 }),
          ],
        },
        { 'eip155:8453': 'Base', 'eip155:1': 'Ethereum' },
      ),
      [DAILY],
    )

    expect(portfolio.chains).toEqual([
      { chainId: 'eip155:8453', name: 'Base', value: 750, share: 0.75 },
      { chainId: 'eip155:1', name: 'Ethereum', value: 250, share: 0.25 },
    ])
  })

  it('falls back to the CAIP id when the connector names no chains', async () => {
    const connector: PortfolioConnector = {
      provider: 'fake',
      positionsFor: async () => [pos({ amount: '1', value: 1 })],
    }
    const portfolio = await readPortfolio(connector, [DAILY])
    expect(portfolio.chains[0]!.name).toBe('eip155:8453')
  })

  it('is empty, not unknown, when there are no arms at all', async () => {
    const portfolio = await readPortfolio(fake({}), [])
    expect(portfolio).toMatchObject({ total: 0, gross: 0, change1d: 0, arms: [], assets: [], chains: [] })
  })

  it('keeps an unpriced holding visible without inventing a value for it', async () => {
    const portfolio = await readPortfolio(
      fake({ '0xaa': [pos({ symbol: 'WAT', amount: '4200000', value: null, price: null })] }),
      [DAILY],
    )

    expect(portfolio.total).toBe(0)
    expect(portfolio.assets[0]).toMatchObject({ amount: '4200000', value: 0, price: null, share: 0 })
  })
})
