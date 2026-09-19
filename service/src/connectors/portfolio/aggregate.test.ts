import { describe, expect, it, vi } from 'vitest'
import { readPortfolio, type ArmRef } from './aggregate.js'
import {
  PortfolioError,
  type AccountPosition,
  type AccountRef,
  type PortfolioConnector,
  type PositionType,
  type ProtocolModule,
} from './types.js'

const ETH_BASE = 'eip155:8453/slip44:60'
const USDC_BASE = 'eip155:8453/erc20:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913'
const USDC_MAINNET = 'eip155:1/erc20:0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48'
const WETH_BASE = 'eip155:8453/erc20:0x4200000000000000000000000000000000000006'

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
  protocolModule?: ProtocolModule | null
  positionName?: string | null
  dappId?: string | null
  groupId?: string | null
}

function pos(input: PositionInput = {}): AccountPosition {
  const assetId = input.assetId ?? USDC_BASE
  const protocol = input.protocol ?? null
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
    protocol,
    protocolModule: input.protocolModule ?? null,
    positionName: input.positionName ?? null,
    dappId: input.dappId ?? (protocol ? protocol.toLowerCase().replace(/\s+/g, '-') : null),
    dappIconUrl: protocol ? `https://icons.test/${protocol}.png` : null,
    dappUrl: null,
    poolAddress: null,
    parentId: null,
    groupId: input.groupId ?? null,
  }
}

/** The two halves of a lending market: collateral and the debt drawn against it. */
const FLUID_DEPOSIT = pos({
  assetId: ETH_BASE, symbol: 'ETH', decimals: 18, amount: '1239808666818550599', value: 3100, change1d: 32,
  positionType: 'deposit', protocol: 'Fluid', protocolModule: 'lending', positionName: 'Fluid Lending (#9468)', groupId: 'g-fluid',
})
const FLUID_LOAN = pos({
  amount: '1202021368', value: 1202, change1d: 0.2,
  positionType: 'loan', protocol: 'Fluid', protocolModule: 'lending', positionName: 'Fluid Lending (#9468)', groupId: 'g-fluid',
})

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
      { walletId: 'w-daily', amount: '1000000', value: 1 },
      { walletId: 'w-vault', amount: '3000000', value: 3 },
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

describe('the token list holds only what is loose in a wallet', () => {
  it('keeps a staked balance out of the token row for the same asset', async () => {
    const portfolio = await readPortfolio(
      fake({
        '0xaa': [
          pos({ amount: '1000000', value: 1 }),
          pos({ amount: '9000000', value: 9, positionType: 'deposit', protocol: 'Aave V3', groupId: 'g' }),
        ],
      }),
      [DAILY],
    )

    expect(portfolio.assets).toHaveLength(1)
    expect(portfolio.assets[0]!.amount).toBe('1000000')
    expect(portfolio.assets[0]!.value).toBe(1)
    expect(portfolio.protocols[0]!.groups[0]!.holdings[0]!.amount).toBe('9000000')
  })

  it('never lets a loan reach the token list, so no token row is negative', async () => {
    const portfolio = await readPortfolio(fake({ '0xaa': [FLUID_DEPOSIT, FLUID_LOAN] }), [DAILY])

    expect(portfolio.assets).toEqual([])
    expect(portfolio.protocols).toHaveLength(1)
  })
})

describe('a protocol is one card, grouped the way the app groups it', () => {
  it('nets a lending market to one group with a deposit row and a loan row', async () => {
    const portfolio = await readPortfolio(fake({ '0xaa': [FLUID_LOAN, FLUID_DEPOSIT] }), [DAILY])

    const fluid = portfolio.protocols[0]!
    expect(fluid).toMatchObject({ id: 'fluid', name: 'Fluid', iconUrl: 'https://icons.test/Fluid.png', value: 1898 })
    expect(fluid.groups).toHaveLength(1)
    const market = fluid.groups[0]!
    expect(market).toMatchObject({ id: 'g-fluid', chainId: 'eip155:8453', name: 'Fluid Lending (#9468)', module: 'lending', value: 1898 })
    // Deposits before debt, whichever order the provider sent them in.
    expect(market.holdings.map((h) => [h.positionType, h.value])).toEqual([['deposit', 3100], ['loan', 1202]])
    // The loan's own value is a magnitude; the type is what says it is owed.
    expect(market.holdings[1]!.value).toBeGreaterThan(0)
    expect(portfolio.total).toBe(1898)
    expect(portfolio.change1d).toBeCloseTo(31.8)
  })

  it('keeps both tokens of a pool in one group', async () => {
    const portfolio = await readPortfolio(
      fake({
        '0xaa': [
          pos({ assetId: WETH_BASE, symbol: 'WETH', decimals: 18, value: 500, positionType: 'deposit', protocol: 'Uniswap V2', protocolModule: 'liquidity_pool', positionName: 'USDC/WETH', groupId: 'pool-1' }),
          pos({ value: 500, positionType: 'deposit', protocol: 'Uniswap V2', protocolModule: 'liquidity_pool', positionName: 'USDC/WETH', groupId: 'pool-1' }),
        ],
      }),
      [DAILY],
    )

    const pool = portfolio.protocols[0]!.groups[0]!
    expect(pool.name).toBe('USDC/WETH')
    expect(pool.holdings.map((h) => h.asset.symbol).sort()).toEqual(['USDC', 'WETH'])
    expect(pool.value).toBe(1000)
  })

  it('gives a reward with no deposit behind it a card of its own', async () => {
    const portfolio = await readPortfolio(
      fake({
        '0xaa': [
          pos({ symbol: 'SEAM', value: 0.07, positionType: 'reward', protocol: 'Merkl', protocolModule: 'rewards', positionName: 'Merkl Rewards', groupId: 'g-merkl' }),
        ],
      }),
      [DAILY],
    )

    expect(portfolio.protocols).toHaveLength(1)
    expect(portfolio.protocols[0]).toMatchObject({ id: 'merkl', value: 0.07 })
    expect(portfolio.protocols[0]!.groups[0]!.holdings[0]!.positionType).toBe('reward')
  })

  it('shows debt with no collateral beside it as a negative card, not as nothing', async () => {
    const portfolio = await readPortfolio(fake({ '0xaa': [FLUID_LOAN] }), [DAILY])

    expect(portfolio.protocols[0]!.value).toBe(-1202)
    expect(portfolio.protocols[0]!.share).toBe(0)
    expect(portfolio.total).toBe(-1202)
  })

  it('merges two arms in the same pool into one group with a row for each', async () => {
    const lp = (value: number) =>
      pos({ value, positionType: 'deposit', protocol: 'Aerodrome', protocolModule: 'liquidity_pool', positionName: 'USDC/AERO', groupId: 'pool-9' })
    const portfolio = await readPortfolio(fake({ '0xaa': [lp(10)], '0xbb': [lp(30)] }), [DAILY, VAULT])

    expect(portfolio.protocols).toHaveLength(1)
    expect(portfolio.protocols[0]!.groups).toHaveLength(1)
    expect(portfolio.protocols[0]!.groups[0]!.holdings.map((h) => [h.walletId, h.value])).toEqual([
      ['w-vault', 30],
      ['w-daily', 10],
    ])
  })

  it('keeps the same pool id on two chains as two groups', async () => {
    const portfolio = await readPortfolio(
      fake({
        '0xaa': [
          pos({ value: 10, positionType: 'deposit', protocol: 'Aave V3', groupId: 'usdc-market' }),
          pos({ assetId: USDC_MAINNET, chainId: 'eip155:1', value: 20, positionType: 'deposit', protocol: 'Aave V3', groupId: 'usdc-market' }),
        ],
      }),
      [DAILY],
    )

    expect(portfolio.protocols).toHaveLength(1)
    expect(portfolio.protocols[0]!.groups.map((g) => g.chainId)).toEqual(['eip155:1', 'eip155:8453'])
  })

  it('sorts protocols and their groups by value, biggest first', async () => {
    const portfolio = await readPortfolio(
      fake({
        '0xaa': [
          pos({ value: 1, positionType: 'reward', protocol: 'Merkl', groupId: 'r' }),
          FLUID_DEPOSIT,
          pos({ value: 5, positionType: 'deposit', protocol: 'Fluid', positionName: 'Fluid Lending (#1)', groupId: 'g-small' }),
        ],
      }),
      [DAILY],
    )

    expect(portfolio.protocols.map((p) => p.id)).toEqual(['fluid', 'merkl'])
    expect(portfolio.protocols[0]!.groups.map((g) => g.value)).toEqual([3100, 5])
  })
})

describe('what is held, by type', () => {
  it('totals each way of holding as a magnitude, and the whole as net', async () => {
    const portfolio = await readPortfolio(
      fake({
        '0xaa': [
          pos({ value: 100 }),
          FLUID_DEPOSIT,
          FLUID_LOAN,
          pos({ value: 40, positionType: 'staked', protocol: 'Lido', groupId: 's' }),
        ],
      }),
      [DAILY],
    )

    expect(portfolio.byType).toEqual({
      wallet: 100, deposit: 3100, loan: 1202, locked: 0, staked: 40, reward: 0, investment: 0,
    })
    expect(portfolio.total).toBe(100 + 3100 - 1202 + 40)
  })
})

describe('shares are of the net total', () => {
  it('reads "Wallet 28%, Fluid 71%" the way a portfolio app does', async () => {
    const portfolio = await readPortfolio(
      fake({ '0xaa': [pos({ value: 760 }), FLUID_DEPOSIT, FLUID_LOAN] }),
      [DAILY],
    )

    expect(portfolio.total).toBe(2658)
    expect(portfolio.assets[0]!.share).toBeCloseTo(760 / 2658)
    expect(portfolio.protocols[0]!.share).toBeCloseTo(1898 / 2658)
    expect(portfolio.assets[0]!.share + portfolio.protocols[0]!.share).toBeCloseTo(1)
  })

  it('has no shares at all when the whole is not positive', async () => {
    const portfolio = await readPortfolio(
      fake({ '0xaa': [pos({ value: 100 }), FLUID_LOAN] }),
      [DAILY],
    )

    expect(portfolio.total).toBe(-1102)
    expect(portfolio.assets[0]!.share).toBe(0)
    expect(portfolio.protocols[0]!.share).toBe(0)
    expect(portfolio.chains[0]!.share).toBe(0)
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
  it('makes the header total the sum of tokens and protocols', async () => {
    const portfolio = await readPortfolio(
      fake({
        '0xaa': [
          pos({ assetId: ETH_BASE, symbol: 'ETH', decimals: 18, amount: '1', value: 900, change1d: 12 }),
          pos({ amount: '100000000', value: 100, change1d: -2 }),
          pos({ value: 50, change1d: 1, positionType: 'staked', protocol: 'Lido', groupId: 's' }),
        ],
        '0xbb': [pos({ amount: '500000000', value: 500, change1d: 1 })],
      }),
      [DAILY, VAULT],
    )

    const tokens = portfolio.assets.reduce((n, a) => n + a.value, 0)
    const apps = portfolio.protocols.reduce((n, p) => n + p.value, 0)
    expect(portfolio.total).toBe(tokens + apps)
    expect(portfolio.total).toBe(1550)
    expect(portfolio.change1d).toBe(12)
    // Each arm's total is net, and the arms add up to the whole.
    expect(portfolio.arms.reduce((n, arm) => n + arm.total, 0)).toBe(1550)
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

  it('breaks the total down by chain, protocols included, with the provider’s name for each', async () => {
    const portfolio = await readPortfolio(
      fake(
        {
          '0xaa': [
            pos({ assetId: ETH_BASE, symbol: 'ETH', decimals: 18, amount: '1', value: 500 }),
            pos({ assetId: USDC_MAINNET, chainId: 'eip155:1', amount: '1', value: 250 }),
            pos({ value: 250, positionType: 'deposit', protocol: 'Aave V3', groupId: 'g' }),
          ],
        },
        { 'eip155:8453': 'Base', 'eip155:1': 'Ethereum' },
      ),
      [DAILY],
    )

    expect(portfolio.chains).toEqual([
      { chainId: 'eip155:8453', name: 'Base', iconUrl: null, value: 750, share: 0.75 },
      { chainId: 'eip155:1', name: 'Ethereum', iconUrl: null, value: 250, share: 0.25 },
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
    expect(portfolio).toMatchObject({ total: 0, change1d: 0, arms: [], assets: [], protocols: [], chains: [] })
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
