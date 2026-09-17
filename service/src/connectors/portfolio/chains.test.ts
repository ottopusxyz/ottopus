import { describe, expect, it } from 'vitest'
import { ChainMap, evmChainIdOf } from './chains.js'

describe('external_id is hex on some chains and decimal on others', () => {
  it('reads both spellings of the same number', () => {
    expect(evmChainIdOf('0x2105')).toBe(8453)
    expect(evmChainIdOf('8453')).toBe(8453)
    expect(evmChainIdOf('0X1')).toBe(1)
  })

  it('has no number for a chain that is not EVM', () => {
    // Solana's entry carries no external_id at all.
    expect(evmChainIdOf(null)).toBeNull()
    expect(evmChainIdOf(undefined)).toBeNull()
    expect(evmChainIdOf('')).toBeNull()
  })

  it('refuses anything that is not plainly a chain id', () => {
    expect(evmChainIdOf('solana')).toBeNull()
    expect(evmChainIdOf('0x')).toBeNull()
    expect(evmChainIdOf('-1')).toBeNull()
    expect(evmChainIdOf('0')).toBeNull()
    expect(evmChainIdOf('1.5')).toBeNull()
    // Beyond Number.MAX_SAFE_INTEGER the value has already been rounded.
    expect(evmChainIdOf('0xffffffffffffffffff')).toBeNull()
  })
})

const ENTRIES = [
  { id: 'base', name: 'Base', externalId: '0x2105' },
  { id: 'ethereum', name: 'Ethereum', externalId: '0x1' },
  { id: 'binance-smart-chain', name: 'BNB Chain', externalId: '0x38' },
  { id: 'solana', name: 'Solana', externalId: null },
]

describe('ChainMap', () => {
  const map = new ChainMap(ENTRIES)

  it('translates a provider slug to CAIP-2', () => {
    expect(map.caipOf('base')).toBe('eip155:8453')
    expect(map.caipOf('binance-smart-chain')).toBe('eip155:56')
  })

  it('translates back, for filter parameters', () => {
    expect(map.slugOf('eip155:8453')).toBe('base')
    expect(map.slugOf('eip155:56')).toBe('binance-smart-chain')
  })

  it('carries the human name, so the UI never prints a slug', () => {
    expect(map.nameOf('eip155:56')).toBe('BNB Chain')
  })

  it('drops chains it cannot name in CAIP-2 rather than inventing one', () => {
    expect(map.caipOf('solana')).toBeNull()
    expect(map.size).toBe(3)
  })

  it('has nothing to say about a chain the provider never listed', () => {
    expect(map.caipOf('hyperevm')).toBeNull()
    expect(map.slugOf('eip155:1337')).toBeNull()
    expect(map.nameOf('eip155:1337')).toBeNull()
  })
})
