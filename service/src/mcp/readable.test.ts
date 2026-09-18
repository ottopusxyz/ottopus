import { describe, expect, it } from 'vitest'
import type { Portfolio } from '../connectors/portfolio/index.js'
import type { Arm } from '../wallets/index.js'
import {
  changeText,
  describeWallet,
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
    expect(describeWallet(arm())).toBe('Rabby — rabby, 0xd8da…6045, can sign')
    expect(describeWallet(arm({ isWatchOnly: true, walletType: 'watch_only' }))).toContain(
      'watch only, cannot sign',
    )
    expect(describeWallet(arm({ provedAt: null }))).toContain('not yet proved, cannot sign')
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
  total: 2816.91,
  gross: 2816.91,
  change1d: -8.26,
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
      spendable: '1258100000000000000',
      value: 2000,
      price: 1589.7,
      change1d: -8,
      share: 0.7,
      holdings: [],
    },
    {
      assetId: 'eip155:8453/erc20:0x1',
      chainId: 'eip155:8453',
      asset: { symbol: 'USDC', name: 'USD Coin', decimals: 6, iconUrl: null, verified: true },
      amount: '816910000',
      spendable: '816910000',
      value: 816.91,
      price: 1,
      change1d: 0,
      share: 0.3,
      holdings: [],
    },
    {
      assetId: 'eip155:8453/erc20:0x2',
      chainId: 'eip155:8453',
      asset: { symbol: 'DUST', name: 'Dust', decimals: 18, iconUrl: null, verified: false },
      amount: '1',
      spendable: '1',
      value: 0,
      price: null,
      change1d: 0,
      share: 0,
      holdings: [],
    },
  ],
}

describe('a portfolio in words', () => {
  const arms = [arm({ id: 'w1', label: 'Main' }), arm({ id: 'w2', label: 'Cold', address: '0xabcd' })]

  it('leads with the total and the day, then the holdings that matter', () => {
    const summary = summarisePortfolio(portfolio, arms, 2)
    const words = portfolioText(summary)
    expect(words.split('\n')[0]).toBe('Total $2,816.91 across 2 wallets, −$8.26 today.')
    expect(words).toContain('- 1.2581 ETH on Ethereum — $2,000.00')
    expect(words).toContain('- 816.91 USDC on Base — $816.91')
    expect(words).toContain('…and 1 smaller.')
    expect(words).not.toContain('DUST')
  })

  it('names the wallets it could not read, so the total is not mistaken for the whole', () => {
    const words = portfolioText(summarisePortfolio(portfolio, arms, 20))
    expect(words).toContain('1 of 2 could not be read (Cold) and are left out of the total.')
  })

  it('names wallets by their label, and counts what it cut', () => {
    const summary = summarisePortfolio(portfolio, arms, 1)
    expect(summary.wallets.map((w) => w.name)).toEqual(['Main', 'Cold'])
    expect(summary.assets).toHaveLength(1)
    expect(summary.omitted).toBe(2)
  })
})
