import { describe, expect, it } from 'vitest'
import { amountSchema, bridgeIntentSchema, swapIntentSchema, transferIntentSchema } from './intent.js'

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
  it('rejects a bridge that does not cross chains', () => {
    expect(() =>
      bridgeIntentSchema.parse({
        kind: 'bridge',
        asset: 'eip155:8453/erc20:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
        amount: '1',
        toChain: 'eip155:8453',
      }),
    ).toThrow(/must cross chains/)
  })

  it('accepts a real bridge', () => {
    const ok = bridgeIntentSchema.parse({
      kind: 'bridge',
      asset: 'eip155:8453/erc20:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
      amount: '1',
      toChain: 'eip155:56',
    })
    expect(ok.toChain).toBe('eip155:56')
  })
})
