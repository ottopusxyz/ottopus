import { describe, expect, it } from 'vitest'
import { WALLET_CHAINS, addChainParams, chainName, explorerName, findChain } from './chains'

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

describe('the words for BNB Chain', () => {
  /** viem says "BNB Smart Chain"; the portfolio beside the review card says "BNB Chain". */
  it('is BNB Chain, spends BNB, and links to BscScan', () => {
    expect(chainName('eip155:56')).toBe('BNB Chain')
    expect(findChain('eip155:56')?.nativeCurrency.symbol).toBe('BNB')
    expect(explorerName('eip155:56')).toBe('BscScan')
    expect(addChainParams('eip155:56')).toMatchObject({ chainName: 'BNB Chain', blockExplorerUrls: ['https://bscscan.com'] })
  })

  it('names the explorer generically when the chain does not know one', () => {
    expect(explorerName('eip155:99999999999')).toBe('the explorer')
  })
})
