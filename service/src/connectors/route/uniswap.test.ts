import { decodeFunctionData, maxUint160 } from 'viem'
import { describe, expect, it } from 'vitest'
import { KNOWN_ABI } from '../../verify/index.js'
import { RouteError, type RouteRequest } from './types.js'
import { PERMIT2_ADDRESS, uniswapConnector } from './uniswap.js'

const BASE = 'eip155:8453'
const ARBITRUM = 'eip155:42161'
const USDC = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913'
const WETH = '0x4200000000000000000000000000000000000006'
const ROUTER = '0x6ff5693b99212da76ad316178a184ab56d299b43'
const SPOKE = '0x09aea4b2242abc8bb4bb78d537a67a245a7bec64'
const ME = `${BASE}:0xd8da6bf26964af9d7eed9e03e53415d37aa96045`
const NOW = new Date('2026-09-10T12:00:00Z')

/** What a call's bytes say, with addresses lowercased as the plan keeps them. */
const decoded = (data: string) => {
  const { functionName, args } = decodeFunctionData({ abi: KNOWN_ABI, data: data as `0x${string}` })
  return { functionName, args: (args ?? []).map((a) => (typeof a === 'string' ? a.toLowerCase() : a)) }
}

const swap: RouteRequest = {
  fromAsset: `${BASE}/erc20:${USDC}`,
  toAsset: `${BASE}/slip44:60`,
  amountIn: '500000000',
  fromAccount: ME,
}

/** The shape the API answered live on 2026-09-13, trimmed to what is read. */
const quote = (over: Record<string, unknown> = {}) => ({
  requestId: 'q1',
  routing: 'CLASSIC',
  isTokenApprovalApplicable: true,
  permitData: { values: { spender: ROUTER } },
  quote: {
    chainId: 8453,
    input: { amount: '500000000', token: USDC },
    output: { amount: '198313504450396709', minimumAmount: '197321936928144725', recipient: ME.split(':')[2] },
    gasFeeUSD: '0.0146932903618735',
    routeString: '[v3] 100.00% = [0.01%] 0xb4CB800910B228ED3d0834cF79D697127BBB00e5',
  },
  ...over,
})

const built = (over: Record<string, unknown> = {}) => ({
  requestId: 's1',
  swap: { to: ROUTER, data: '0x3593564CABCD', value: '0x00', chainId: 8453 },
  ...over,
})

/** A fake trade-api that records what it was asked, answering /quote then /swap. */
function server(answers: { quote?: unknown; swap?: unknown; status?: number } = {}) {
  const seen: { path: string; headers: Record<string, string>; body: Record<string, unknown> }[] = []
  const doFetch = (async (url: unknown, init?: RequestInit) => {
    const path = new URL(String(url)).pathname.replace(/^\/v1/, '')
    seen.push({
      path,
      headers: Object.fromEntries(Object.entries(init?.headers ?? {})),
      body: JSON.parse(String(init?.body)) as Record<string, unknown>,
    })
    const answer = path === '/quote' ? (answers.quote ?? quote()) : (answers.swap ?? built())
    return new Response(JSON.stringify(answer), {
      status: path === '/quote' ? (answers.status ?? 200) : 200,
      headers: { 'content-type': 'application/json' },
    })
  }) as unknown as typeof fetch
  return { seen, connector: uniswapConnector({ apiKey: 'k', fetch: doFetch, now: () => NOW }) }
}

describe('the Uniswap route provider', () => {
  it('serves the chains on its list, in either direction, and no other', () => {
    const { connector } = server()
    expect(connector.serves(BASE, BASE)).toBe(true)
    expect(connector.serves(BASE, ARBITRUM)).toBe(true)
    expect(connector.serves('eip155:4663', 'eip155:4663')).toBe(true)
    // Mantle is a chain the registry knows and this provider does not.
    expect(connector.serves('eip155:5000', 'eip155:5000')).toBe(false)
    expect(connector.serves(BASE, 'eip155:5000')).toBe(false)
    expect(connector.serves(BASE, 'solana:mainnet')).toBe(false)
  })

  it('declines a chain off its list before asking', async () => {
    const { seen, connector } = server()
    await expect(
      connector.route({ ...swap, fromAsset: 'eip155:5000/slip44:60', toAsset: 'eip155:5000/erc20:0x09bc4e0d864854c6afb6eb9a9cdf58ac190d0df9' }),
    ).rejects.toMatchObject({ code: 'unsupported' })
    expect(seen).toHaveLength(0)
  })

  it('asks for a quote, then the transaction, and never a simulation', async () => {
    const { seen, connector } = server()
    await connector.route({ ...swap, slippageBps: 50 })
    expect(seen.map((s) => s.path)).toEqual(['/quote', '/swap'])
    expect(seen[0]!.headers['x-api-key']).toBe('k')
    expect(seen[0]!.body).toMatchObject({
      type: 'EXACT_INPUT',
      amount: '500000000',
      tokenInChainId: 8453,
      tokenOutChainId: 8453,
      tokenIn: USDC,
      tokenOut: '0x0000000000000000000000000000000000000000',
      swapper: '0xd8da6bf26964af9d7eed9e03e53415d37aa96045',
      slippageTolerance: 0.5,
      protocols: ['V2', 'V3', 'V4'],
    })
    expect(seen[1]!.body.simulateTransaction).toBe(false)
    // The transaction is built from the quote as given, with no permit signed.
    expect(seen[1]!.body).not.toHaveProperty('signature')
    expect(seen[1]!.body).not.toHaveProperty('permitData')
  })

  /**
   * The allowance is built here, in two exact calls, rather than taken from
   * the API's unlimited approval and permit signature.
   */
  it('makes a token swap’s allowance through Permit2: two exact calls, the grant with a deadline', async () => {
    const { connector } = server()
    const result = await connector.route(swap)
    expect(result.calls).toHaveLength(3)

    const [approve, grant, router] = result.calls
    expect(approve!.to).toBe(`${BASE}:${USDC}`)
    expect(decoded(approve!.data)).toEqual({
      functionName: 'approve',
      args: [PERMIT2_ADDRESS, 500_000_000n],
    })
    expect(grant!.to).toBe(`${BASE}:${PERMIT2_ADDRESS}`)
    expect(decoded(grant!.data)).toEqual({
      functionName: 'approve',
      args: [USDC, ROUTER, 500_000_000n, Math.floor(NOW.getTime() / 1000) + 30 * 60],
    })
    expect(router).toEqual({ to: `${BASE}:${ROUTER}`, value: '0', data: '0x3593564cabcd', chainId: BASE })

    expect(result.approval).toEqual({
      spender: `${BASE}:${ROUTER}`,
      asset: swap.fromAsset,
      amount: '500000000',
      through: `${BASE}:${PERMIT2_ADDRESS}`,
    })
    expect(result.nativeFee).toBeNull()
  })

  it('needs no allowance when the input is the chain’s own currency, and sends it as value', async () => {
    const { connector } = server({
      quote: quote({ isTokenApprovalApplicable: false, permitData: null, quote: { ...quote().quote, input: { amount: '100000000000000000' } } }),
      swap: built({ swap: { to: ROUTER, data: '0x3593564c', value: '0x16345785d8a0000', chainId: 8453 } }),
    })
    const result = await connector.route({ ...swap, fromAsset: `${BASE}/slip44:60`, toAsset: `${BASE}/erc20:${USDC}`, amountIn: '100000000000000000' })
    expect(result.calls).toHaveLength(1)
    expect(result.calls[0]!.value).toBe('100000000000000000')
    expect(result.approval).toBeNull()
    expect(result.nativeFee).toBeNull()
  })

  it('approves the bridge contract directly, since it pulls the token itself', async () => {
    const { connector } = server({
      quote: quote({
        routing: 'BRIDGE',
        permitData: null,
        quote: {
          chainId: 8453,
          destinationChainId: 42161,
          output: { amount: '49987824', minimumAmount: '49987824' },
          estimatedFillTimeMs: 1000,
          gasFeeUSD: '0.002',
        },
      }),
      swap: built({ swap: { to: SPOKE, data: '0x7b939232', value: '0x00', chainId: 8453 } }),
    })
    const result = await connector.route({ ...swap, toAsset: `${ARBITRUM}/erc20:0xaf88d065e77c8cc2239327c5edb3a432268e5831`, amountIn: '50000000' })
    expect(result.calls).toHaveLength(2)
    expect(decoded(result.calls[0]!.data)).toEqual({
      functionName: 'approve',
      args: [SPOKE, 50_000_000n],
    })
    expect(result.approval).toEqual({ spender: `${BASE}:${SPOKE}`, asset: swap.fromAsset, amount: '50000000' })
    expect(result.etaSeconds).toBe(1)
    expect(result.steps).toEqual(['Bridge to Arbitrum One'])
  })

  it('declares native value on a token route as the route’s fee', async () => {
    const { connector } = server({
      quote: quote({ routing: 'BRIDGE', permitData: null, quote: { chainId: 8453, output: { amount: '1', minimumAmount: '1' } } }),
      swap: built({ swap: { to: SPOKE, data: '0x7b939232', value: '0x9184e72a000', chainId: 8453 } }),
    })
    const result = await connector.route({ ...swap, toAsset: `${ARBITRUM}/erc20:0xaf88d065e77c8cc2239327c5edb3a432268e5831` })
    expect(result.nativeFee).toBe('10000000000000')
    expect(result.calls[1]!.value).toBe('10000000000000')
  })

  it('unwraps with a call on the wrapped token itself, and no allowance', async () => {
    const { connector } = server({
      quote: quote({ routing: 'UNWRAP', isTokenApprovalApplicable: false, permitData: null, quote: { chainId: 8453, output: { amount: '10', minimumAmount: '10' } } }),
      swap: built({ swap: { to: WETH, data: '0x2e1a7d4d', value: '0x00', chainId: 8453 } }),
    })
    const result = await connector.route({ ...swap, fromAsset: `${BASE}/erc20:${WETH}`, amountIn: '10' })
    expect(result.calls).toHaveLength(1)
    expect(result.approval).toBeNull()
    expect(result.steps).toEqual(['Unwrap to ETH'])
  })

  it('carries the floor, the expectation and the gas in dollars', async () => {
    const { connector } = server()
    const result = await connector.route(swap)
    expect(result.expectedOut).toBe('198313504450396709')
    expect(result.minOut).toBe('197321936928144725')
    expect(result.feesUsd).toBe('0.01')
    expect(result.etaSeconds).toBeNull()
    expect(result.expiresAt).toBe('2026-09-10T12:03:00.000Z')
  })

  it('names the pool versions the route string mentions', async () => {
    const { connector } = server()
    expect((await connector.route(swap)).steps).toEqual(['Swap on Uniswap v3'])
    const mixed = server({
      quote: quote({ quote: { ...quote().quote, routeString: '[V2] 40.00% = 0xaa, [V3] 60.00% = [0.05%] 0xbb' } }),
    })
    expect((await mixed.connector.route(swap)).steps).toEqual(['Swap on Uniswap v2 and v3'])
  })

  describe('what it refuses', () => {
    it('a UniswapX order, which is a signature for a filler and not a transaction', async () => {
      for (const routing of ['DUTCH_V2', 'DUTCH_V3', 'PRIORITY']) {
        const { seen, connector } = server({ quote: quote({ routing }) })
        await expect(connector.route(swap)).rejects.toMatchObject({ code: 'unsupported' })
        await expect(connector.route(swap)).rejects.toThrow(/UniswapX order/)
        expect(seen.every((s) => s.path === '/quote')).toBe(true)
      }
    })

    it('a chained route, which is more than one chain', async () => {
      const { connector } = server({ quote: quote({ routing: 'CHAINED' }) })
      await expect(connector.route(swap)).rejects.toThrow(/chained route/)
    })

    it('a permit naming a spender other than the contract called', async () => {
      const { connector } = server({ quote: quote({ permitData: { values: { spender: SPOKE } } }) })
      await expect(connector.route(swap)).rejects.toMatchObject({ code: 'provider_failed' })
    })

    it('a transaction built for another chain', async () => {
      const { connector } = server({ swap: built({ swap: { to: ROUTER, data: '0x00', value: '0x00', chainId: 1 } }) })
      await expect(connector.route(swap)).rejects.toThrow(/chain 1/)
    })

    it('an amount a Permit2 allowance cannot hold', async () => {
      const { connector } = server()
      await expect(connector.route({ ...swap, amountIn: (maxUint160 + 1n).toString() })).rejects.toMatchObject({ code: 'unsupported' })
    })

    it('a quote by the amount coming out', async () => {
      const { connector } = server()
      await expect(connector.route({ ...swap, amountIn: undefined, amountOut: '1' })).rejects.toThrow(/amountIn/)
    })

    it('sending the output somewhere other than the signer', async () => {
      const { connector } = server()
      await expect(connector.route({ ...swap, toAccount: `${BASE}:0x1111111111111111111111111111111111111111` })).rejects.toMatchObject({
        code: 'unsupported',
      })
    })
  })

  describe('when it cannot answer', () => {
    it('reads a 404 as no route, with the provider’s reason', async () => {
      const { connector } = server({
        quote: { errorCode: 'NoRouteFoundError', detail: 'No route with sufficient liquidity was found for this pair.' },
        status: 404,
      })
      const err = await connector.route(swap).catch((e: unknown) => e)
      expect(err).toBeInstanceOf(RouteError)
      expect((err as RouteError).code).toBe('no_route')
      expect((err as RouteError).message).toBe('uniswap found no route for this pair at this size: No route with sufficient liquidity was found for this pair.')
    })

    it('reads a refused key as the provider failing, never as no route', async () => {
      const { connector } = server({ quote: { errorCode: 'Unauthorized' }, status: 401 })
      await expect(connector.route(swap)).rejects.toMatchObject({ code: 'provider_failed' })
    })

    it('refuses a quote with nothing to sign', async () => {
      const { connector } = server({ swap: { requestId: 's', swap: null } })
      await expect(connector.route(swap)).rejects.toThrow(/no transaction to sign/)
    })
  })
})
