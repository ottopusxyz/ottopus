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
  it('finds the token, the chain and the wallet client by the ids the plan carries', () => {
    const plan = planFor('0191a2b3-c4d5-4e6f-8a9b-0c1d2e3f4a5b')
    expect(visualsFor(plan, arms, portfolio)).toEqual({
      assets: { 'eip155:8453/slip44:60': { symbol: 'ETH', name: 'Ether', iconUrl: 'https://cdn/eth.png' } },
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
  it('keeps only what is known: the chain from core, no icons, no wallet', () => {
    const plan = planFor('0191a2b3-c4d5-4e6f-8a9b-0c1d2e3f4a5b')
    expect(visualsFor(plan, [], null)).toEqual({
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
