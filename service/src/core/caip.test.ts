import { describe, expect, it } from 'vitest'
import {
  CaipError,
  accountIdSchema,
  accountOn,
  assetIdSchema,
  chainIdSchema,
  chainOf,
  formatAccountId,
  fromEvmChainId,
  isNativeAsset,
  nativeAssetOf,
  parseAccountId,
  parseAssetId,
  parseChainId,
  toEvmChainId,
} from './caip.js'

describe('chain ids', () => {
  it('parses and reformats', () => {
    expect(parseChainId('eip155:8453')).toEqual({ namespace: 'eip155', reference: '8453' })
  })

  it('rejects a bare chain number', () => {
    expect(() => parseChainId('8453')).toThrow(CaipError)
  })

  it('converts to and from an EVM chain id', () => {
    expect(toEvmChainId('eip155:8453')).toBe(8453)
    expect(fromEvmChainId(56)).toEqual({ namespace: 'eip155', reference: '56' })
  })

  it('refuses to give an EVM id for a non-EVM chain', () => {
    // Returning NaN here would silently target the wrong network.
    expect(() => toEvmChainId('solana:5eykt4Usc')).toThrow(/not an EVM chain/)
  })
})

describe('account ids', () => {
  it('lowercases EVM addresses so one wallet cannot look like two', () => {
    const mixed = 'eip155:8453:0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045'
    const lower = 'eip155:8453:0xd8da6bf26964af9d7eed9e03e53415d37aa96045'
    expect(formatAccountId(parseAccountId(mixed))).toBe(lower)
    expect(parseAccountId(mixed).address).toBe(parseAccountId(lower).address)
  })

  it('leaves non-EVM addresses alone, where case is significant', () => {
    const solana = 'solana:5eykt4Usc:7S3P4HxJpyyigGzodYwHtCxZyUQe9L4'
    expect(parseAccountId(solana).address).toBe('7S3P4HxJpyyigGzodYwHtCxZyUQe9L4')
  })

  it('builds an account from a chain', () => {
    expect(accountOn({ namespace: 'eip155', reference: '1' }, '0xD8DA6BF26964AF9D7EED9E03E53415D37AA96045')).toBe(
      'eip155:1:0xd8da6bf26964af9d7eed9e03e53415d37aa96045',
    )
  })

  it('recovers the chain from an account', () => {
    expect(chainOf(parseAccountId('eip155:8453:0xd8da6bf26964af9d7eed9e03e53415d37aa96045'))).toEqual({
      namespace: 'eip155',
      reference: '8453',
    })
  })

  it('rejects an address with no chain', () => {
    expect(() => parseAccountId('0xd8da6bf26964af9d7eed9e03e53415d37aa96045')).toThrow(CaipError)
  })
})

describe('asset ids', () => {
  it('parses an ERC-20', () => {
    const usdc = parseAssetId('eip155:8453/erc20:0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913')
    expect(usdc.assetNamespace).toBe('erc20')
    expect(usdc.assetReference).toBe('0x833589fcd6edb6e08f4c7c32d4f71b54bda02913')
  })

  it('parses an NFT with a token id', () => {
    const nft = parseAssetId('eip155:1/erc721:0x0000000000000000000000000000000000000001/1234')
    expect(nft.tokenId).toBe('1234')
  })

  it('recognises the native asset', () => {
    expect(nativeAssetOf('eip155:8453')).toBe('eip155:8453/slip44:60')
    expect(isNativeAsset('eip155:8453/slip44:60')).toBe(true)
    expect(isNativeAsset('eip155:8453/erc20:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913')).toBe(false)
  })

  it('rejects a bare token address', () => {
    expect(() => parseAssetId('0x833589fcd6edb6e08f4c7c32d4f71b54bda02913')).toThrow(CaipError)
  })
})

describe('schemas normalise on the way in', () => {
  it('returns a lowercased account, so callers cannot forget', () => {
    expect(accountIdSchema.parse('eip155:1:0xD8DA6BF26964AF9D7EED9E03E53415D37AA96045')).toBe(
      'eip155:1:0xd8da6bf26964af9d7eed9e03e53415d37aa96045',
    )
  })

  it('accepts valid chain and asset ids', () => {
    expect(chainIdSchema.parse('eip155:8453')).toBe('eip155:8453')
    expect(assetIdSchema.parse('eip155:8453/slip44:60')).toBe('eip155:8453/slip44:60')
  })

  it('rejects the shapes an agent is most likely to send', () => {
    expect(() => accountIdSchema.parse('0xabc')).toThrow()
    expect(() => chainIdSchema.parse('base')).toThrow()
    expect(() => chainIdSchema.parse('8453')).toThrow()
    expect(() => assetIdSchema.parse('USDC')).toThrow()
  })
})

describe('eip155 is validated properly, not just as generic CAIP', () => {
  it('rejects a non-numeric chain reference', () => {
    // Well-formed CAIP, cannot produce a transaction.
    expect(() => parseChainId('eip155:base')).toThrow(/positive decimal/)
  })

  it('rejects a short or non-hex account address', () => {
    expect(() => parseAccountId('eip155:1:0xabc')).toThrow(/20-byte/)
    expect(() => parseAccountId('eip155:1:hello')).toThrow(/20-byte/)
  })

  it('rejects a short contract address for token assets', () => {
    expect(() => parseAssetId('eip155:1/erc20:0xabc')).toThrow(/contract address/)
    expect(() => parseAssetId('eip155:1/erc721:0xabc')).toThrow(/contract address/)
  })

  it('still allows non-contract asset namespaces through', () => {
    expect(parseAssetId('eip155:1/slip44:60').assetReference).toBe('60')
  })

  it('refuses a chain id beyond safe integer range', () => {
    expect(() => toEvmChainId('eip155:99999999999999999999')).toThrow()
    expect(() => fromEvmChainId(Number.MAX_SAFE_INTEGER + 2)).toThrow()
  })
})

describe('native assets are per chain, not assumed to be ETH', () => {
  it('gives ETH on ethereum and base', () => {
    expect(nativeAssetOf('eip155:1')).toBe('eip155:1/slip44:60')
    expect(nativeAssetOf('eip155:8453')).toBe('eip155:8453/slip44:60')
  })

  it('gives BNB, not ETH, on BNB Smart Chain', () => {
    expect(nativeAssetOf('eip155:56')).toBe('eip155:56/slip44:714')
  })

  it('throws on an unknown chain rather than naming the wrong currency', () => {
    expect(() => nativeAssetOf('eip155:1337')).toThrow(/unknown native currency/)
  })
})

describe('slip44 references must match the chain', () => {
  it('rejects ETH coin type on BNB Chain', () => {
    // Well-formed CAIP, and isNativeAsset would have called it native — while
    // naming the wrong currency.
    expect(() => parseAssetId('eip155:56/slip44:60')).toThrow(/slip44:714/)
  })

  it('accepts the right coin type on each chain', () => {
    expect(parseAssetId('eip155:56/slip44:714').assetReference).toBe('714')
    expect(parseAssetId('eip155:8453/slip44:60').assetReference).toBe('60')
    expect(parseAssetId('eip155:137/slip44:966').assetReference).toBe('966')
  })

  it('leaves unknown chains alone, having nothing to check against', () => {
    expect(parseAssetId('eip155:1337/slip44:60').assetReference).toBe('60')
  })
})

describe('constructors enforce what the parsers enforce', () => {
  it('refuses to build an account on a malformed chain', () => {
    expect(() => accountOn({ namespace: 'eip155', reference: 'base' }, '0xd8da6bf26964af9d7eed9e03e53415d37aa96045')).toThrow(
      /positive decimal/,
    )
  })

  it('refuses to build an account from a short address', () => {
    expect(() => accountOn({ namespace: 'eip155', reference: '1' }, '0xabc')).toThrow(/20-byte/)
  })

  it('round-trips: anything built parses back', () => {
    const id = accountOn({ namespace: 'eip155', reference: '8453' }, '0xd8da6bf26964af9d7eed9e03e53415d37aa96045')
    expect(parseAccountId(id).address).toBe('0xd8da6bf26964af9d7eed9e03e53415d37aa96045')
  })
})
