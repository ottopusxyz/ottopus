import { describe, expect, it } from 'vitest'
import { WALLET_CHAINS, addChainParams, findChain } from './chains'

describe('the wallet chain list', () => {
  it('is every mainnet the registry knows, each id once, Base first', () => {
    const ids = WALLET_CHAINS.map((chain) => chain.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids[0]).toBe(8453)
    expect(WALLET_CHAINS.some((chain) => chain.testnet === true)).toBe(false)
    expect(ids.length).toBeGreaterThan(100)
  })

  it('reaches the chains the portfolio reads that Privy’s default list does not', () => {
    // Robinhood is the one that surfaced this; Katana came along.
    for (const id of [4663, 747474, 4326, 1135]) {
      expect(WALLET_CHAINS.some((chain) => chain.id === id), String(id)).toBe(true)
    }
  })

  it('can teach a wallet a chain from the same registry', () => {
    expect(findChain('eip155:4663')?.name).toBe('Robinhood Chain')
    const params = addChainParams('eip155:4663')
    expect(params).toMatchObject({ chainId: '0x1237', nativeCurrency: { symbol: 'ETH' } })
    expect(params?.rpcUrls.length).toBeGreaterThan(0)
  })
})
