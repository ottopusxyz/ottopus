import { describe, expect, it } from 'vitest'
import type { Portfolio } from '../connectors/portfolio/index.js'
import type { Arm } from '../wallets/index.js'
import {
  changeText,
  describeWallet,
  resolveWallet,
  humanAmount,
  portfolioText,
  summarisePortfolio,
  walletName,
  walletsText,
} from './readable.js'

const arm = (over: Partial<Arm> = {}): Arm => ({
  id: 'w1',
  namespace: 'eip155',
  address: '0xd8da6bf26964af9d7eed9e03e53415d37aa96045',
  label: null,
  walletType: 'rabby',
  isWatchOnly: false,
  provedAt: '2026-09-05T00:00:00Z',
  createdAt: '2026-09-05T00:00:00Z',
  ...over,
})

describe('amounts in words', () => {
  it('turns base units into a number a person would say', () => {
    expect(humanAmount('1258100000000000000', 18)).toBe('1.2581')
    expect(humanAmount('2000000', 6)).toBe('2')
    expect(humanAmount('1234567890123', 6)).toBe('1,234,567.8901')
  })

  it('never rounds dust to zero, because zero means none', () => {
    expect(humanAmount('1', 18)).toBe('<0.0001')
    expect(humanAmount('0', 18)).toBe('0')
  })

  it('keeps a debt negative', () => {
    expect(humanAmount('-1500000', 6)).toBe('-1.5')
  })

  it('returns what it was given rather than throwing on a non-integer', () => {
    expect(humanAmount('1.5', 18)).toBe('1.5')
  })

  it('says the day in money, with the sign a person reads', () => {
    expect(changeText(12.4)).toBe('+$12.40 today')
    expect(changeText(-8.26)).toBe('−$8.26 today')
    expect(changeText(0.001)).toBe('no change today')
  })
})

describe('wallets in words', () => {
  it('uses the label when there is one, and the software when there is not', () => {
    expect(walletName(arm({ label: 'Main' }))).toBe('Main')
    expect(walletName(arm({ walletType: 'coinbase_wallet' }))).toBe('Coinbase Wallet')
  })

  it('says whether Otto can ask it to sign', () => {
    expect(describeWallet(arm())).toBe('Rabby — rabby, 0xd8da6bf26964af9d7eed9e03e53415d37aa96045, can sign, id w1')
    expect(describeWallet(arm({ isWatchOnly: true, walletType: 'watch_only' }))).toContain(
      'watch only, cannot sign',
    )
    expect(describeWallet(arm({ provedAt: null }))).toContain('not yet proved, cannot sign')
  })

  it('finds a wallet however it is named', () => {
    const arms = [arm({ label: 'Main' }), arm({ id: 'w2', label: null, walletType: 'safe', address: '0x9f925f63561e3bf88c320125ff3fdb742a5f6464' })]
    const found = (ref: string) => {
      const match = resolveWallet(arms, ref)
      return match.ok ? match.arm.id : match.reason
    }
    expect(found('w2')).toBe('w2')
    expect(found('safe')).toBe('w2')
    expect(found('Main')).toBe('w1')
    expect(found('0x9F925F63561E3BF88C320125FF3FDB742A5F6464')).toBe('w2')
    expect(found('eip155:8453:0x9f925f63561e3bf88c320125ff3fdb742a5f6464')).toBe('w2')
    expect(found('2')).toBe('w2')
    expect(found('0x0000000000000000000000000000000000000001')).toMatch(/not a wallet linked.*Linked: Main \(0xd8da/)
    expect(found('ledger')).toMatch(/"ledger" is not a wallet linked/)
    expect(found('9')).toMatch(/no wallet number 9/)
  })

  it('will not toss a coin between two wallets with one name', () => {
    const arms = [arm({ label: 'Cold' }), arm({ id: 'w2', label: 'Cold', address: '0x9f925f63561e3bf88c320125ff3fdb742a5f6464' })]
    const match = resolveWallet(arms, 'cold')
    expect(match.ok).toBe(false)
    if (!match.ok) expect(match.reason).toMatch(/could be any of Cold \(0xd8da.*Cold \(0x9f92.*name it by address/)
  })

  it('numbers the list, and says when there is none', () => {
    expect(walletsText([arm(), arm({ id: 'w2', label: 'Cold', isWatchOnly: true })])).toMatch(
      /^2 wallets linked:\n1\. Rabby[^\n]*\n2\. Cold/,
    )
    expect(walletsText([])).toMatch(/No wallets are linked yet/)
  })
})

const portfolio: Portfolio = {
  provider: 'zerion',
  currency: 'usd',
  asOf: '2026-09-09T10:00:00Z',
  total: 2816.91 + 1898,
  change1d: -8.26,
  unpriced: 1,
  byType: { wallet: 2816.91, deposit: 3100, loan: 1202, locked: 0, staked: 0, reward: 0, investment: 0 },
  arms: [
    { walletId: 'w1', address: '0xd8da…', status: 'ok', total: 2800, change1d: -8, positionCount: 3 },
    { walletId: 'w2', address: '0xabcd…', status: 'unavailable', total: 0, change1d: 0, positionCount: 0 },
  ],
  chains: [
    { chainId: 'eip155:1', name: 'Ethereum', value: 2000, share: 0.7 },
    { chainId: 'eip155:8453', name: 'Base', value: 816.91, share: 0.3 },
  ],
  assets: [
    {
      assetId: 'eip155:1/slip44:60',
      chainId: 'eip155:1',
      asset: { symbol: 'ETH', name: 'Ether', decimals: 18, iconUrl: null, verified: true },
      amount: '1258100000000000000',
      value: 2000,
      price: 1589.7,
      change1d: -8,
      share: 0.7,
      holdings: [
        { walletId: 'w1', amount: '900000000000000000', value: 1430 },
        { walletId: 'w1', amount: '100000000000000000', value: 159 },
        { walletId: 'w2', amount: '258100000000000000', value: 411 },
      ],
    },
    {
      assetId: 'eip155:8453/erc20:0x1',
      chainId: 'eip155:8453',
      asset: { symbol: 'USDC', name: 'USD Coin', decimals: 6, iconUrl: null, verified: true },
      amount: '816910000',
      value: 816.91,
      price: 1,
      change1d: 0,
      share: 0.3,
      holdings: [{ walletId: 'w1', amount: '816910000', value: 816.91 }],
    },
    {
      assetId: 'eip155:8453/erc20:0x2',
      chainId: 'eip155:8453',
      asset: { symbol: 'DUST', name: 'Dust', decimals: 18, iconUrl: null, verified: false },
      amount: '1',
      value: 0,
      price: null,
      change1d: 0,
      share: 0,
      holdings: [],
    },
  ],
  protocols: [
    {
      id: 'fluid',
      name: 'Fluid',
      iconUrl: null,
      url: null,
      value: 1898,
      change1d: 0,
      share: 0.4,
      unpriced: 0,
      groups: [
        {
          id: 'g-fluid',
          chainId: 'eip155:8453',
          name: 'Fluid Lending (#9468)',
          module: 'lending',
          value: 1898,
          change1d: 0,
          unpriced: 0,
          holdings: [
            {
              walletId: 'w1',
              assetId: 'eip155:8453/slip44:60',
              chainId: 'eip155:8453',
              asset: { symbol: 'ETH', name: 'Ether', decimals: 18, iconUrl: null, verified: true },
              positionType: 'deposit',
              amount: '1239800000000000000',
              value: 3100,
              price: 2500,
              change1d: 32,
            },
            {
              walletId: 'w1',
              assetId: 'eip155:8453/erc20:0x1',
              chainId: 'eip155:8453',
              asset: { symbol: 'USDC', name: 'USD Coin', decimals: 6, iconUrl: null, verified: true },
              positionType: 'loan',
              amount: '1202021368',
              value: 1202,
              price: 1,
              change1d: 0.2,
            },
          ],
        },
      ],
    },
  ],
}

describe('a portfolio in words', () => {
  const arms = [arm({ id: 'w1', label: 'Main' }), arm({ id: 'w2', label: 'Cold', address: '0xabcd' })]

  it('leads with the total and the day, then the holdings that matter', () => {
    const summary = summarisePortfolio(portfolio, arms, 2)
    const words = portfolioText(summary)
    expect(words.split('\n')[0]).toBe('Total $4,714.91 across 2 wallets, −$8.26 today.')
    expect(words).toContain('In wallets, highest value first:')
    expect(words).toContain('- 1.2581 ETH on Ethereum across 2 wallets — $2,000.00')
    expect(words).toContain('- 816.91 USDC on Base in Main — $816.91')
    expect(words).toContain('…and 1 smaller.')
    expect(words).not.toContain('DUST')
  })

  it('names the wallets it could not read, so the total is not mistaken for the whole', () => {
    const words = portfolioText(summarisePortfolio(portfolio, arms, 20))
    expect(words).toContain('1 of 2 could not be read (Cold) and are left out of the total.')
  })

  it('says what sits in each protocol in words, debt included, and what it nets to', () => {
    const summary = summarisePortfolio(portfolio, arms, 2)
    expect(summary.protocols).toEqual([
      {
        id: 'fluid',
        name: 'Fluid',
        value: 1898,
        unpriced: 0,
        positions: [
          {
            name: 'Fluid Lending (#9468)',
            chain: 'Base',
            value: 1898,
            unpriced: 0,
            holdings: [
              { symbol: 'ETH', amount: '1.2398', held: 'deposited', value: 3100, wallet: { id: 'w1', name: 'Main' } },
              { symbol: 'USDC', amount: '1,202.0213', held: 'borrowed', value: 1202, wallet: { id: 'w1', name: 'Main' } },
            ],
          },
        ],
      },
    ])
    expect(portfolioText(summary)).toContain(
      '- Fluid — Fluid Lending (#9468) on Base: 1.2398 ETH deposited ($3,100.00) in Main, 1,202.0213 USDC borrowed ($1,202.00) in Main; net $1,898.00',
    )
  })

  it('never calls a partly priced group a net', () => {
    const fluid = portfolio.protocols[0]!
    const group = fluid.groups[0]!
    const partial = {
      ...portfolio,
      protocols: [{
        ...fluid, unpriced: 1,
        groups: [{ ...group, value: -1202, unpriced: 1, holdings: [{ ...group.holdings[0]!, value: null }, group.holdings[1]!] }],
      }],
    }
    const summary = summarisePortfolio(partial, arms, 2)
    expect(summary.protocols[0]).toMatchObject({ unpriced: 1, positions: [{ unpriced: 1, value: -1202 }] })
    expect(portfolioText(summary)).toContain(
      '1.2398 ETH deposited (no price) in Main, 1,202.0213 USDC borrowed ($1,202.00) in Main; priced part -$1,202.00, 1 holding unpriced',
    )
  })

  it('says so when everything is in protocols and nothing is loose', () => {
    const words = portfolioText(summarisePortfolio({ ...portfolio, assets: [] }, arms, 2))
    expect(words).toContain('Nothing loose in any wallet.')
    expect(words).toContain('In protocols:')
    expect(portfolioText(summarisePortfolio({ ...portfolio, assets: [], protocols: [] }, arms, 2))).toContain('No balances found.')
  })

  it('says which wallets hold each asset, and how much, most first', () => {
    const [eth, usdc] = summarisePortfolio(portfolio, arms, 2).assets
    // Two rows from the same wallet are one entry: what the wallet holds.
    expect(eth!.wallets).toEqual([
      { id: 'w1', name: 'Main', amount: '1' },
      { id: 'w2', name: 'Cold', amount: '0.2581' },
    ])
    expect(usdc!.wallets).toEqual([{ id: 'w1', name: 'Main', amount: '816.91' }])
  })

  it('tells two unlabelled wallets apart by their address', () => {
    const unlabelled = [
      arm({ id: 'w1', label: null, walletType: 'watch_only', address: '0x1111000000000000000000000000000000001111' }),
      arm({ id: 'w2', label: null, walletType: 'watch_only', address: '0x2222000000000000000000000000000000002222' }),
    ]
    const [eth] = summarisePortfolio(portfolio, unlabelled, 1).assets
    expect(eth!.wallets.map((w) => w.name)).toEqual([
      'Watch Only 0x1111…1111',
      'Watch Only 0x2222…2222',
    ])
  })

  it('names wallets by their label, and counts what it cut', () => {
    const summary = summarisePortfolio(portfolio, arms, 1)
    expect(summary.wallets.map((w) => w.name)).toEqual(['Main', 'Cold'])
    expect(summary.assets).toHaveLength(1)
    expect(summary.omitted).toBe(2)
  })
})

describe('asset ids for the agent', () => {
  const arms = [arm({ id: 'w1', label: 'Main' }), arm({ id: 'w2', label: 'Cold', address: '0xabcd' })]

  it('carries each holding’s CAIP-19 id in the structure and on the line', () => {
    const summary = summarisePortfolio(portfolio, arms, 5)
    for (const row of summary.assets) {
      expect(row.assetId).toMatch(/^eip155:\d+\/(erc20|slip44):/)
      expect(row.chainId).toMatch(/^eip155:\d+$/)
      expect(Number.isInteger(row.decimals)).toBe(true)
    }
    const words = portfolioText(summary)
    expect(words).toContain(`[${summary.assets[0]!.assetId}]`)
  })
})
