import { describe, expect, it } from 'vitest'
import type { Portfolio } from '../connectors/portfolio/index.js'
import type { Arm } from '../wallets/index.js'
import { ACCOUNT, planFor } from './fixtures.js'
import { visualsFor } from './visuals.js'

const arms: Arm[] = [
  {
    id: 'w1',
    namespace: 'eip155',
    address: '0x0000000000000000000000000000000000000001',
    label: 'Main',
    walletType: 'rabby',
    isWatchOnly: false,
    provedAt: '2026-09-05T00:00:00Z',
    createdAt: '2026-09-05T00:00:00Z',
  },
]

const portfolio = {
  chains: [{ chainId: 'eip155:8453', name: 'Base', iconUrl: 'https://cdn/base.png', value: 1, share: 1 }],
  assets: [
    {
      assetId: 'eip155:8453/slip44:60',
      chainId: 'eip155:8453',
      asset: { symbol: 'ETH', name: 'Ether', decimals: 18, iconUrl: 'https://cdn/eth.png', verified: true },
      amount: '1',
      value: 1,
      price: 1,
      change1d: 0,
      share: 1,
      holdings: [],
    },
  ],
} as unknown as Portfolio

describe('visuals beside the plan', () => {
  it('finds the token, the chain and the wallet client by the ids the plan carries', async () => {
    const plan = planFor('0191a2b3-c4d5-4e6f-8a9b-0c1d2e3f4a5b')
    expect(await visualsFor(plan, arms, portfolio)).toEqual({
      assets: { 'eip155:8453/slip44:60': { symbol: 'ETH', name: 'Ether', iconUrl: 'https://cdn/eth.png', priceUsd: 1 } },
      chains: { 'eip155:8453': { name: 'Base', iconUrl: 'https://cdn/base.png', nativeAssetId: 'eip155:8453/slip44:60', nativeSymbol: 'ETH', nativeDecimals: 18 } },
      wallets: { [ACCOUNT]: { walletType: 'rabby', label: 'Main' } },
    })
  })

  /**
   * The chain entry survives a missing portfolio because the page needs the
   * native asset id to name what the browser's own simulation reports, and
   * that comes from core, not from a balance provider. Icons are the part
   * that goes missing.
   */
  it('keeps only what is known: the chain from core, no icons, no wallet', async () => {
    const plan = planFor('0191a2b3-c4d5-4e6f-8a9b-0c1d2e3f4a5b')
    expect(await visualsFor(plan, [], null)).toEqual({
      assets: {},
      chains: {
        'eip155:8453': {
          name: 'Base',
          iconUrl: null,
          nativeAssetId: 'eip155:8453/slip44:60',
          nativeSymbol: 'ETH',
          nativeDecimals: 18,
        },
      },
      wallets: {},
    })
  })
})

describe('a bridge', () => {
  it('carries the destination chain too, so the arriving row can wear its badge', async () => {
    const plan = planFor('0191a2b3-c4d5-4e6f-8a9b-0c1d2e3f4a5b')
    const bridge = {
      ...plan,
      intent: { kind: 'bridge', from: 'eip155:8453/slip44:60', to: 'eip155:42161/slip44:60', amountIn: '1', slippageBps: 50 },
    } as unknown as Plan
    const visuals = await visualsFor(bridge, arms, portfolio, null, (chainId) => (chainId === 'eip155:42161' ? 'https://cdn/arb.png' : null))
    expect(Object.keys(visuals.chains).sort()).toEqual(['eip155:42161', 'eip155:8453'])
    // The portfolio has nothing on Arbitrum, so the mark comes from the provider's chain list.
    expect(visuals.chains['eip155:42161']).toMatchObject({ name: 'Arbitrum One', nativeSymbol: 'ETH', iconUrl: 'https://cdn/arb.png' })
    expect(visuals.chains['eip155:8453']?.iconUrl).toBe('https://cdn/base.png')
  })
})

describe('an asset the portfolio has never seen', () => {
  /**
   * A trade's receiving side, which nobody holds yet by definition. Without
   * a registry the one row the person is deciding about had no name and no
   * icon.
   */
  const registry = {
    name: 'fake',
    async byAssetId(assetId: string) {
      return assetId.endsWith('efed')
        ? {
            assetId,
            symbol: 'DEGEN',
            name: 'Degen',
            decimals: 18,
            iconUrl: 'https://cdn/degen.webp',
            priceUsd: 0.001,
            verified: true,
          }
        : null
    },
    async find() {
      return null
    },
  }
  const swap = () =>
    planFor('0191a2b3-c4d5-4e6f-8a9b-0c1d2e3f4a5b', {
      intent: {
        kind: 'swap',
        from: 'eip155:8453/slip44:60',
        to: 'eip155:8453/erc20:0x4ed4e862860bed51a9570b96d89af5e1b0efefed',
        amountIn: '1000',
      },
    })

  it('takes the words and the icon from the registry', async () => {
    const visuals = await visualsFor(swap(), [], null, registry)
    expect(visuals.assets['eip155:8453/erc20:0x4ed4e862860bed51a9570b96d89af5e1b0efefed']).toEqual({
      symbol: 'DEGEN',
      name: 'Degen',
      iconUrl: 'https://cdn/degen.webp',
      priceUsd: 0.001,
    })
  })

  it('leaves the row out rather than inventing one when nobody knows it', async () => {
    const visuals = await visualsFor(swap(), [], null, { ...registry, async byAssetId() {
      return null
    } })
    expect(visuals.assets).toEqual({})
  })
})
