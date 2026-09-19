import { describe, expect, it } from 'vitest'
import {
  amountSchema,
  bridgeIntentSchema,
  crossesChains,
  customIntentSchema,
  destinationChainOf,
  sourceChainOf,
  swapIntentSchema,
  transferIntentSchema,
} from './intent.js'

describe('amounts', () => {
  it('takes base units as a string', () => {
    expect(amountSchema.parse('500000000')).toBe('500000000')
  })

  it('rejects a number, a float and a negative', () => {
    // 10^18 wei exceeds Number.MAX_SAFE_INTEGER, so a float would quietly lose
    // precision on an amount someone is about to sign.
    expect(() => amountSchema.parse(500 as unknown as string)).toThrow()
    expect(() => amountSchema.parse('1.5')).toThrow()
    expect(() => amountSchema.parse('-1')).toThrow()
  })
})

describe('transfer intent', () => {
  it('normalises the destination account', () => {
    const intent = transferIntentSchema.parse({
      kind: 'transfer',
      asset: 'eip155:8453/erc20:0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
      amount: '500000000',
      to: 'eip155:8453:0xD8DA6BF26964AF9D7EED9E03E53415D37AA96045',
    })
    expect(intent.to).toBe('eip155:8453:0xd8da6bf26964af9d7eed9e03e53415d37aa96045')
  })

  it('rejects a bare token symbol', () => {
    const bad = { kind: 'transfer', asset: 'USDC', amount: '1', to: 'eip155:1:0xd8da6bf26964af9d7eed9e03e53415d37aa96045' }
    expect(() => transferIntentSchema.parse(bad)).toThrow()
  })

  it('leaves fromAccount optional, so the scorer can choose', () => {
    const intent = transferIntentSchema.parse({
      kind: 'transfer',
      asset: 'eip155:1/slip44:60',
      amount: '1',
      to: 'eip155:1:0xd8da6bf26964af9d7eed9e03e53415d37aa96045',
    })
    expect(intent.fromAccount).toBeUndefined()
  })
})

describe('swap intent', () => {
  const base = { kind: 'swap', from: 'eip155:8453/slip44:60', to: 'eip155:8453/erc20:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913' }

  it('accepts exactly one fixed side', () => {
    expect(swapIntentSchema.parse({ ...base, amountIn: '1000' }).amountIn).toBe('1000')
    expect(swapIntentSchema.parse({ ...base, amountOut: '1000' }).amountOut).toBe('1000')
  })

  it('rejects both sides fixed, which has no single answer', () => {
    expect(() => swapIntentSchema.parse({ ...base, amountIn: '1', amountOut: '1' })).toThrow()
  })

  it('rejects neither side fixed', () => {
    expect(() => swapIntentSchema.parse(base)).toThrow()
  })

  it('caps slippage, because a wide tolerance is a real loss', () => {
    expect(() => swapIntentSchema.parse({ ...base, amountIn: '1', slippageBps: 5000 })).toThrow()
    expect(() => swapIntentSchema.parse({ ...base, amountIn: '1', slippageBps: 0 })).toThrow()
    expect(swapIntentSchema.parse({ ...base, amountIn: '1', slippageBps: 50 }).slippageBps).toBe(50)
  })
})

describe('rejects zero amounts', () => {
  it('will not build a plan for nothing', () => {
    expect(() => amountSchema.parse('0')).toThrow(/greater than zero/)
    expect(() => amountSchema.parse('000')).toThrow(/greater than zero/)
  })
})

describe('every identifier in an intent must be on one chain', () => {
  it('rejects a transfer whose asset and recipient are on different chains', () => {
    expect(() =>
      transferIntentSchema.parse({
        kind: 'transfer',
        asset: 'eip155:8453/erc20:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
        amount: '1',
        to: 'eip155:1:0xd8da6bf26964af9d7eed9e03e53415d37aa96045',
      }),
    ).toThrow(/same chain/)
  })

  it('rejects a transfer funded from an account on a third chain', () => {
    expect(() =>
      transferIntentSchema.parse({
        kind: 'transfer',
        asset: 'eip155:8453/erc20:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
        amount: '1',
        to: 'eip155:8453:0xd8da6bf26964af9d7eed9e03e53415d37aa96045',
        fromAccount: 'eip155:56:0x0000000000000000000000000000000000000001',
      }),
    ).toThrow(/same chain/)
  })

  it('rejects a cross-chain swap, which is a bridge', () => {
    expect(() =>
      swapIntentSchema.parse({
        kind: 'swap',
        from: 'eip155:8453/slip44:60',
        to: 'eip155:1/erc20:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
        amountIn: '1',
      }),
    ).toThrow(/bridge/)
  })

  it('accepts a same-chain transfer', () => {
    const ok = transferIntentSchema.parse({
      kind: 'transfer',
      asset: 'eip155:8453/erc20:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
      amount: '1',
      to: 'eip155:8453:0xd8da6bf26964af9d7eed9e03e53415d37aa96045',
      fromAccount: 'eip155:8453:0x0000000000000000000000000000000000000001',
    })
    expect(ok.kind).toBe('transfer')
  })
})

describe('bridge intent', () => {
  it('rejects a bridge that does not cross chains, and names what that is', () => {
    expect(() =>
      bridgeIntentSchema.parse({
        kind: 'bridge',
        from: 'eip155:8453/erc20:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
        to: 'eip155:8453/slip44:60',
        amountIn: '1',
      }),
    ).toThrow(/must cross chains/)
  })

  /**
   * The case the old shape could not express. A bridge used to be `{asset,
   * amount, toChain}`, which only moved the same asset elsewhere — so "USDC
   * on Base for ETH on BNB Chain", the thing people ask for, had nowhere to
   * live.
   */
  it('accepts a different asset on the other side', () => {
    const ok = bridgeIntentSchema.parse({
      kind: 'bridge',
      from: 'eip155:8453/erc20:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
      to: 'eip155:56/slip44:714',
      amountIn: '1',
    })
    expect(ok).toMatchObject({ from: 'eip155:8453/erc20:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', to: 'eip155:56/slip44:714', amountIn: '1' })
  })

  it('insists on exactly one side being fixed, like a swap', () => {
    const both = { kind: 'bridge', from: 'eip155:8453/erc20:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', to: 'eip155:56/slip44:714' }
    expect(() => bridgeIntentSchema.parse({ ...both, amountIn: '1', amountOut: '2' })).toThrow(/exactly one/)
    expect(() => bridgeIntentSchema.parse(both)).toThrow(/exactly one/)
  })

  it('reads the destination chain off the asset, and knows it is crossing', () => {
    const bridge = bridgeIntentSchema.parse({
      kind: 'bridge',
      from: 'eip155:8453/erc20:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
      to: 'eip155:56/slip44:714',
      amountIn: '1',
    })
    expect(sourceChainOf(bridge)).toEqual({ namespace: 'eip155', reference: '8453' })
    expect(destinationChainOf(bridge)).toEqual({ namespace: 'eip155', reference: '56' })
    expect(crossesChains(bridge)).toBe(true)
  })

  /** A transfer's `to` is an account, not an asset; reading it as one threw. */
  it('reads a transfer’s destination from its asset, never from its recipient', () => {
    const transfer = transferIntentSchema.parse({
      kind: 'transfer',
      asset: 'eip155:8453/erc20:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
      amount: '1',
      to: 'eip155:8453:0xd8da6bf26964af9d7eed9e03e53415d37aa96045',
    })
    expect(destinationChainOf(transfer)).toEqual({ namespace: 'eip155', reference: '8453' })
    expect(crossesChains(transfer)).toBe(false)
  })

  it('says a swap and a transfer stay on one chain', () => {
    const swap = swapIntentSchema.parse({
      kind: 'swap',
      from: 'eip155:8453/erc20:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
      to: 'eip155:8453/slip44:60',
      amountIn: '1',
    })
    expect(crossesChains(swap)).toBe(false)
    expect(destinationChainOf(swap)).toEqual(sourceChainOf(swap))
  })
})

describe('note', () => {
  it('is kept, trimmed, and bounded', () => {
    const base = {
      kind: 'transfer' as const,
      asset: 'eip155:8453/slip44:60',
      amount: '1',
      to: 'eip155:8453:0xd8da6bf26964af9d7eed9e03e53415d37aa96045',
    }
    expect(transferIntentSchema.parse({ ...base, note: '  rent ' }).note).toBe('rent')
    expect(transferIntentSchema.parse(base).note).toBeUndefined()
    expect(() => transferIntentSchema.parse({ ...base, note: 'x'.repeat(201) })).toThrow()
    expect(() => transferIntentSchema.parse({ ...base, note: '   ' })).toThrow()
  })
})

describe('custom intent', () => {
  const BASE = 'eip155:8453'
  const ME = `${BASE}:0xd8da6bf26964af9d7eed9e03e53415d37aa96045`
  const USDC = `${BASE}/erc20:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913`
  const WETH = `${BASE}/erc20:0x4200000000000000000000000000000000000006`
  const PM = `${BASE}:0x03a520b32c04bf3beef7beb72e919cf822ed34f1`

  const honest = {
    kind: 'custom' as const,
    fromAccount: ME,
    chainId: BASE,
    summary: 'Add 1 USDC and the matching WETH to the USDC/WETH 0.05% pool',
    expectedChanges: [
      { asset: USDC, maxOut: '1000000' },
      { asset: WETH, maxOut: '1208327299744937' },
    ],
    approvals: [{ asset: USDC, spender: PM, amount: '1000000' }],
  }

  it('is a declaration: what leaves, at most, and what gets approved, exactly', () => {
    const intent = customIntentSchema.parse(honest)
    expect(intent.expectedChanges).toHaveLength(2)
    expect(intent.approvals[0]?.amount).toBe('1000000')
    expect(sourceChainOf(intent)).toEqual({ namespace: 'eip155', reference: '8453' })
    // Nothing crosses a chain: the calls and the account are all on one.
    expect(crossesChains(intent)).toBe(false)
    expect(destinationChainOf(intent)).toEqual(sourceChainOf(intent))
  })

  it('cannot say "unlimited" — the shape only takes an exact amount', () => {
    const unlimited = { ...honest, approvals: [{ asset: USDC, spender: PM, amount: 'unlimited' }] }
    expect(() => customIntentSchema.parse(unlimited)).toThrow()
    const max = { ...honest, approvals: [{ asset: USDC, spender: PM, amount: '0x' + 'f'.repeat(64) }] }
    expect(() => customIntentSchema.parse(max)).toThrow()
  })

  /** The calls bind a wallet, so there is nothing to recommend; the account is an input. */
  it('requires the account', () => {
    const { fromAccount: _omit, ...none } = honest
    expect(() => customIntentSchema.parse(none)).toThrow()
  })

  it('holds every identifier to the one chain', () => {
    const otherAccount = { ...honest, fromAccount: 'eip155:1:0xd8da6bf26964af9d7eed9e03e53415d37aa96045' }
    expect(() => customIntentSchema.parse(otherAccount)).toThrow(/same chain/)
    const otherAsset = { ...honest, expectedChanges: [{ asset: 'eip155:1/erc20:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', maxOut: '1' }] }
    expect(() => customIntentSchema.parse(otherAsset)).toThrow(/same chain/)
    const otherSpender = { ...honest, approvals: [{ asset: USDC, spender: 'eip155:1:0x03a520b32c04bf3beef7beb72e919cf822ed34f1', amount: '1' }] }
    expect(() => customIntentSchema.parse(otherSpender)).toThrow(/same chain/)
  })

  it('needs words, and not too many of them', () => {
    expect(() => customIntentSchema.parse({ ...honest, summary: '   ' })).toThrow()
    expect(() => customIntentSchema.parse({ ...honest, summary: 'x'.repeat(281) })).toThrow()
  })

  it('may declare nothing leaving at all, for a claim or a revoke', () => {
    const intent = customIntentSchema.parse({ ...honest, expectedChanges: [], approvals: [] })
    expect(intent.expectedChanges).toEqual([])
  })
})
