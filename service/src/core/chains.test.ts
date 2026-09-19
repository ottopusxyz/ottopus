import { describe, expect, it } from 'vitest'
import { CaipError, NATIVE_COIN_TYPE_CHAINS, nativeAssetOf } from './caip.js'
import {
  chainName,
  explorerAddressUrl,
  explorerTxUrl,
  findChain,
  isSupportedChain,
  listChains,
  requireChain,
  rpcUrlFor,
} from './chains.js'

describe('the registry', () => {
  it('knows Base by its CAIP-2 id', () => {
    const base = findChain('eip155:8453')
    expect(base).toMatchObject({ id: 'eip155:8453', evmId: 8453, name: 'Base', testnet: false })
    expect(base!.nativeCurrency.symbol).toBe('ETH')
    expect(base!.publicRpcUrls.length).toBeGreaterThan(0)
  })

  it('covers most EVM chains, not two', () => {
    expect(listChains().filter((c) => !c.testnet).length).toBeGreaterThan(100)
  })

  /**
   * The coin-type table in caip.ts and viem's list must not drift: a chain we
   * can name the currency of but cannot read is a portfolio row nobody can
   * act on.
   */
  it('knows every chain the coin-type table names', () => {
    for (const ref of NATIVE_COIN_TYPE_CHAINS) {
      const id = `eip155:${ref}`
      expect(isSupportedChain(id), id).toBe(true)
      expect(() => nativeAssetOf(id)).not.toThrow()
    }
  })

  it('agrees with the coin-type table about which chains spend ETH', () => {
    for (const ref of NATIVE_COIN_TYPE_CHAINS) {
      const spendsEth = nativeAssetOf(`eip155:${ref}`).endsWith('/slip44:60')
      expect(findChain(`eip155:${ref}`)!.nativeCurrency.symbol === 'ETH', ref).toBe(spendsEth)
    }
  })

  it('refuses an unknown chain by name, never falling back to Ethereum', () => {
    expect(findChain('eip155:99999999999')).toBeNull()
    expect(() => requireChain('eip155:99999999999')).toThrow(CaipError)
    expect(() => requireChain('eip155:99999999999')).toThrow(/eip155:99999999999/)
  })

  it('has no opinion about non-EVM namespaces', () => {
    expect(findChain({ namespace: 'solana', reference: 'mainnet' })).toBeNull()
  })

  it('names a chain, and falls back to the id for one it does not know', () => {
    expect(chainName('eip155:1')).toBe('Ethereum')
    expect(chainName('eip155:99999999999')).toBe('eip155:99999999999')
  })
})

describe('rpc resolution', () => {
  it('substitutes the chain id into a provider template', () => {
    expect(rpcUrlFor('eip155:8453', 'https://rpc.example/v1/{chainId}/KEY')).toBe('https://rpc.example/v1/8453/KEY')
  })

  it('falls back to the public endpoint without a template', () => {
    expect(rpcUrlFor('eip155:8453')).toMatch(/^https:\/\//)
  })

  it('refuses a chain it does not know even with a template', () => {
    expect(() => rpcUrlFor('eip155:99999999999', 'https://rpc.example/{chainId}')).toThrow(CaipError)
  })
})

describe('explorer links', () => {
  it('links a transaction and an address', () => {
    expect(explorerTxUrl('eip155:8453', '0xabc')).toBe('https://basescan.org/tx/0xabc')
    expect(explorerAddressUrl('eip155:1', '0xdef')).toBe('https://etherscan.io/address/0xdef')
  })

  it('is null rather than a broken link for a chain with no explorer', () => {
    expect(explorerTxUrl('eip155:99999999999', '0xabc')).toBeNull()
  })
})
