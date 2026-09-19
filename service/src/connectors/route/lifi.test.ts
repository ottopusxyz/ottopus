import { decodeFunctionData, maxUint256 } from 'viem'
import { describe, expect, it } from 'vitest'
import { KNOWN_ABI } from '../../verify/index.js'
import { lifiConnector } from './lifi.js'
import { RouteError, type RouteRequest } from './types.js'

const BASE = 'eip155:8453'
const USDC = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913'
const ROUTER = '0x1231deb6f5749ef6ce6943a275a1d3e7486f4eae'
const ME = `${BASE}:0xd8da6bf26964af9d7eed9e03e53415d37aa96045`
const NOW = new Date('2026-09-10T12:00:00Z')

const swap: RouteRequest = {
  fromAsset: `${BASE}/erc20:${USDC}`,
  toAsset: `${BASE}/slip44:60`,
  amountIn: '500000000',
  fromAccount: ME,
}

const quote = (over: Record<string, unknown> = {}) => ({
  tool: 'aerodrome',
  estimate: {
    toAmount: '120000000000000000',
    toAmountMin: '119400000000000000',
    approvalAddress: ROUTER,
    feeCosts: [{ amountUSD: '0.15' }],
    gasCosts: [{ amountUSD: '0.16' }],
  },
  includedSteps: [{ type: 'swap', toolDetails: { name: 'Aerodrome' } }],
  transactionRequest: { to: ROUTER, data: '0xDEADBEEF', value: '0', chainId: 8453 },
  ...over,
})

/** A fake li.quest that records what it was asked. */
function server(answer: unknown, status = 200) {
  const seen: URL[] = []
  const doFetch = (async (url: unknown) => {
    seen.push(new URL(String(url)))
    return new Response(typeof answer === 'string' ? answer : JSON.stringify(answer), {
      status,
      headers: { 'content-type': 'application/json' },
    })
  }) as unknown as typeof fetch
  return { seen, connector: lifiConnector({ fetch: doFetch, now: () => NOW }) }
}

describe('the route provider', () => {
  it('serves any EVM pair the registry knows, in either direction', () => {
    const { connector } = server(quote())
    expect(connector.serves(BASE, BASE)).toBe(true)
    expect(connector.serves(BASE, 'eip155:1')).toBe(true)
    expect(connector.serves(BASE, 'solana:mainnet')).toBe(false)
    expect(connector.serves(BASE, 'eip155:99999999999')).toBe(false)
  })

  /**
   * The one request parameter that is not negotiable. Letting the router
   * simulate would make the routing vendor a simulation vendor, which is the
   * single thing invariant 4 forbids.
   */
  it('always asks the router not to simulate', async () => {
    const { seen, connector } = server(quote())
    await connector.route(swap)
    expect(seen[0]!.searchParams.get('skipSimulation')).toBe('true')
  })

  it('asks in the provider’s own units: chain ids, addresses, a slippage fraction', async () => {
    const { seen, connector } = server(quote())
    await connector.route({ ...swap, slippageBps: 50 })
    const q = seen[0]!.searchParams
    expect(q.get('fromChain')).toBe('8453')
    expect(q.get('toChain')).toBe('8453')
    expect(q.get('fromToken')).toBe(USDC)
    // The chain's own currency is the zero address to this provider.
    expect(q.get('toToken')).toBe('0x0000000000000000000000000000000000000000')
    expect(q.get('fromAmount')).toBe('500000000')
    expect(q.get('fromAddress')).toBe('0xd8da6bf26964af9d7eed9e03e53415d37aa96045')
    expect(q.get('toAddress')).toBe('0xd8da6bf26964af9d7eed9e03e53415d37aa96045')
    expect(q.get('slippage')).toBe('0.005')
  })

  /**
   * The approval is ours. The provider names a spender but not an amount, so
   * encoding it here is what makes "exact" true rather than hoped for.
   */
  it('builds the approval itself, for exactly the amount going in', async () => {
    const { connector } = server(quote())
    const route = await connector.route(swap)

    expect(route.calls).toHaveLength(2)
    expect(route.approval).toEqual({ spender: `${BASE}:${ROUTER}`, asset: `${BASE}/erc20:${USDC}`, amount: '500000000' })
    const approve = route.calls[0]!
    expect(approve.to).toBe(`${BASE}:${USDC}`)
    expect(approve.value).toBe('0')
    const { functionName, args } = decodeFunctionData({ abi: KNOWN_ABI, data: approve.data as `0x${string}` })
    expect(functionName).toBe('approve')
    // viem decodes an address back checksummed; the bytes are the same.
    expect(String(args?.[0]).toLowerCase()).toBe(ROUTER)
    expect(args?.[1]).toBe(500_000_000n)
    expect(args?.[1]).not.toBe(maxUint256)
  })

  it('lowercases the router’s calldata and keeps its value', async () => {
    const { connector } = server(quote({ transactionRequest: { to: ROUTER, data: '0xABCDEF', value: '0x0', chainId: 8453 } }))
    const route = await connector.route(swap)
    expect(route.calls[1]).toMatchObject({ to: `${BASE}:${ROUTER}`, data: '0xabcdef', value: '0', chainId: BASE })
  })

  it('needs no approval when the input is the chain’s own currency', async () => {
    const { connector } = server(quote())
    const route = await connector.route({ ...swap, fromAsset: `${BASE}/slip44:60`, toAsset: `${BASE}/erc20:${USDC}` })
    expect(route.approval).toBeNull()
    expect(route.calls).toHaveLength(1)
  })

  it('carries the floor, the expectation and the total cost', async () => {
    const { connector } = server(quote())
    const route = await connector.route(swap)
    expect(route).toMatchObject({
      provider: 'lifi',
      expectedOut: '120000000000000000',
      minOut: '119400000000000000',
      // 15 cents of provider fee plus 16 of gas.
      feesUsd: '0.31',
      steps: ['Swap on Aerodrome'],
    })
  })

  /** Live, the provider returned its own fee collection as a step called "Integrator Fee". */
  it('leaves the provider’s fee collection out of the route’s steps', async () => {
    const { connector } = server(
      quote({
        includedSteps: [
          { type: 'protocol', toolDetails: { name: 'Integrator Fee' } },
          { type: 'swap', toolDetails: { name: 'SushiSwap Aggregator' } },
        ],
      }),
    )
    const route = await connector.route(swap)
    expect(route.steps).toEqual(['Swap on SushiSwap Aggregator'])
  })

  it('gives the quote a clock of its own, since the provider gives none', async () => {
    const { connector } = server(quote())
    const route = await connector.route(swap)
    expect(Date.parse(route.expiresAt) - NOW.getTime()).toBe(3 * 60_000)
  })

  it('names the destination chain when the route crosses one', async () => {
    const { connector } = server(
      quote({
        includedSteps: [
          { type: 'swap', toolDetails: { name: 'Aerodrome' } },
          { type: 'cross', toolDetails: { name: 'Across' } },
        ],
      }),
    )
    const route = await connector.route({ ...swap, toAsset: 'eip155:1/slip44:60' })
    expect(route.steps).toEqual(['Swap on Aerodrome', 'Bridge with Across to Ethereum'])
  })

  describe('when it cannot answer', () => {
    it('reads a 404 as no route, not as a failure', async () => {
      const { connector } = server({}, 404)
      await expect(connector.route(swap)).rejects.toMatchObject({ code: 'no_route' })
    })

    it('repeats the provider’s reason but never its request', async () => {
      const { connector } = server(JSON.stringify({ message: 'amount too small' }), 400)
      await expect(connector.route(swap)).rejects.toThrow(/answered 400: amount too small/)
      const leaky = server(JSON.stringify({ message: 'failed calling https://li.quest/v1/quote?key=secret' }), 500)
      await expect(leaky.connector.route(swap)).rejects.toThrow(/answered 500$/)
    })

    it('refuses a quote with nothing to sign', async () => {
      const { connector } = server(quote({ transactionRequest: undefined }))
      await expect(connector.route(swap)).rejects.toMatchObject({ code: 'provider_failed' })
    })

    it('says plainly that it cannot quote by the amount coming out', async () => {
      const { connector } = server(quote())
      const attempt = connector.route({ ...swap, amountIn: undefined, amountOut: '100' })
      await expect(attempt).rejects.toBeInstanceOf(RouteError)
      await expect(attempt).rejects.toThrow(/quotes by the amount going in/)
    })
  })
})
