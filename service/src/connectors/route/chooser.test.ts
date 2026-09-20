import { describe, expect, it } from 'vitest'
import { chooser } from './chooser.js'
import { RouteError, type RouteConnector, type RouteQuote, type RouteRequest } from './types.js'

const BASE = 'eip155:8453'
const MANTLE = 'eip155:5000'

const request: RouteRequest = {
  fromAsset: `${BASE}/erc20:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913`,
  toAsset: `${BASE}/slip44:60`,
  amountIn: '500000000',
  fromAccount: `${BASE}:0xd8da6bf26964af9d7eed9e03e53415d37aa96045`,
}

const quoteFrom = (provider: string): RouteQuote => ({
  provider,
  calls: [],
  expectedOut: '1',
  minOut: '1',
  approval: null,
  nativeFee: null,
  feesUsd: null,
  expiresAt: '2026-09-10T12:03:00.000Z',
  etaSeconds: null,
  steps: [],
  raw: {},
})

/** A provider that serves the chains named, and answers as told. */
function provider(name: string, chains: string[], answer: RouteQuote | RouteError | Error): RouteConnector & { asked: number } {
  const p = {
    name,
    asked: 0,
    serves: (a: string, b: string) => chains.includes(a) && chains.includes(b),
    async route() {
      p.asked++
      if (answer instanceof Error) throw answer
      return answer
    },
  }
  return p
}

describe('the route chooser', () => {
  it('serves what any of its providers serves', () => {
    const picked = chooser([provider('a', [BASE], quoteFrom('a')), provider('b', [BASE, MANTLE], quoteFrom('b'))])
    expect(picked.serves(BASE, BASE)).toBe(true)
    expect(picked.serves(MANTLE, MANTLE)).toBe(true)
    expect(picked.serves(BASE, 'eip155:1')).toBe(false)
  })

  it('asks the first provider that serves the pair, and no other', async () => {
    const a = provider('a', [BASE], quoteFrom('a'))
    const b = provider('b', [BASE], quoteFrom('b'))
    expect((await chooser([a, b]).route(request)).provider).toBe('a')
    expect(b.asked).toBe(0)
  })

  it('skips a provider that does not serve the pair', async () => {
    const a = provider('a', ['eip155:1'], quoteFrom('a'))
    const b = provider('b', [BASE], quoteFrom('b'))
    expect((await chooser([a, b]).route(request)).provider).toBe('b')
    expect(a.asked).toBe(0)
  })

  it('falls through when the preferred provider finds no route', async () => {
    const a = provider('a', [BASE], new RouteError('no_route', 'a found nothing'))
    const b = provider('b', [BASE], quoteFrom('b'))
    expect((await chooser([a, b]).route(request)).provider).toBe('b')
  })

  it('falls through when the preferred provider is down', async () => {
    const a = provider('a', [BASE], new RouteError('provider_failed', 'a could not be reached'))
    const b = provider('b', [BASE], quoteFrom('b'))
    expect((await chooser([a, b]).route(request)).provider).toBe('b')
  })

  it('lets anything that is not a route error through untouched', async () => {
    const a = provider('a', [BASE], new TypeError('a bug'))
    const b = provider('b', [BASE], quoteFrom('b'))
    await expect(chooser([a, b]).route(request)).rejects.toThrow(TypeError)
    expect(b.asked).toBe(0)
  })

  it('joins every reason, each with its provider’s name, when all fail', async () => {
    const a = provider('a', [BASE], new RouteError('provider_failed', 'could not be reached'))
    const b = provider('b', [BASE], new RouteError('no_route', 'found nothing'))
    const err = await chooser([a, b]).route(request).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(RouteError)
    expect((err as RouteError).code).toBe('no_route')
    expect((err as RouteError).message).toBe('a: could not be reached; b: found nothing')
  })

  it('passes a lone failure through as it was', async () => {
    const a = provider('a', [BASE], new RouteError('no_route', 'found nothing'))
    const b = provider('b', ['eip155:1'], quoteFrom('b'))
    await expect(chooser([a, b]).route(request)).rejects.toThrow('found nothing')
  })

  it('says so when nobody serves the pair', async () => {
    const a = provider('a', ['eip155:1'], quoteFrom('a'))
    await expect(chooser([a]).route(request)).rejects.toMatchObject({
      code: 'unsupported',
      message: 'no route provider (a) routes between these chains',
    })
  })

  it('names its providers, in order', () => {
    expect(chooser([provider('a', [], quoteFrom('a')), provider('b', [], quoteFrom('b'))]).name).toBe('a, b')
  })
})
