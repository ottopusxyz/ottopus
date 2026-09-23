import { decodeFunctionData } from 'viem'
import { describe, expect, it } from 'vitest'
import { KNOWN_ABI } from '../../verify/index.js'
import { BinanceClient } from '../binance/index.js'
import { binanceRouteConnector, slippagePercentOf } from './binance.js'
import { RouteError, type RouteRequest } from './types.js'

const BSC = 'eip155:56'
const BASE = 'eip155:8453'
const USDT = '0x55d398326f99059ff775485246999027b3197955'
const NVDAB = '0x02fca66c1d1afb4e2a7884261eb00f63598a7436'
const ROUTER = '0xb44446b0c8e56988c34f7ff73ae904982b5fdda5'
const ME = `${BSC}:0xd8da6bf26964af9d7eed9e03e53415d37aa96045`
const NOW = new Date('2026-09-23T06:00:00Z')

/** What a call's bytes say, with addresses lowercased as the plan keeps them. */
const decoded = (data: string) => {
  const { functionName, args } = decodeFunctionData({ abi: KNOWN_ABI, data: data as `0x${string}` })
  return { functionName, args: (args ?? []).map((a) => (typeof a === 'string' ? a.toLowerCase() : a)) }
}

const swap: RouteRequest = {
  fromAsset: `${BSC}/erc20:${USDT}`,
  toAsset: `${BSC}/erc20:${NVDAB}`,
  amountIn: '10000000000000000000',
  fromAccount: ME,
}

/** The shape the API answered live on 2026-09-23, trimmed to what is read. */
const route = (over: Record<string, unknown> = {}) => ({
  quoteId: '9ca6e53f664b4450a781d757def09bb9',
  vendorName: 'LiquidMesh',
  executionMode: 'SWAP',
  binanceChainId: '56',
  fromTokenAmount: '10000000000000000000',
  toTokenAmount: '43682817718545246',
  tradeFee: '0.02175733',
  estimateGasFee: '450000',
  priceImpactPercent: '0.0002095193',
  approveTarget: '0xB44446b0c8E56988c34f7Ff73Ae904982b5FdDA5',
  isBest: true,
  dexRouterList: [{ dexProtocol: { dexName: 'Metric', percent: '100.00' } }],
  ...over,
})

const built = (over: Record<string, unknown> = {}, tx: Record<string, unknown> = {}) => ({
  executionMode: 'SWAP',
  routerResult: { toTokenAmount: '43686428204291323', vendorName: 'LiquidMesh', dexRouterList: [{ dexProtocol: { dexName: 'Metric' } }] },
  tx: {
    from: '0xd8da6bf26964af9d7eed9e03e53415d37aa96045',
    to: '0xB44446b0c8E56988c34f7Ff73Ae904982b5FdDA5',
    data: '0xAD43F73DCAFE',
    value: '0',
    minReceiveAmount: '43467996063269866',
    slippagePercent: '0.5',
    ...tx,
  },
  rfq: null,
  ...over,
})

const envelope = (data: unknown, code = 0, msg = 'success') => ({ code, msg, data, success: code === 0 })

/**
 * A fake vendor behind the real signed client, answering `/quote` and
 * `/swap` from a script and recording what each was asked.
 */
function server(answers: { quote?: unknown; swap?: unknown; status?: number } = {}) {
  const seen: { path: string; query: URLSearchParams }[] = []
  const doFetch = (async (url: unknown) => {
    const u = new URL(String(url))
    const path = u.pathname.replace(/^\/build/, '')
    seen.push({ path, query: u.searchParams })
    const body = path.endsWith('/quote') ? (answers.quote ?? envelope([route()])) : (answers.swap ?? envelope(built()))
    return new Response(JSON.stringify(body), {
      status: path.endsWith('/quote') ? (answers.status ?? 200) : 200,
      headers: { 'content-type': 'application/json' },
    })
  }) as unknown as typeof fetch
  const client = new BinanceClient({ apiKey: 'k', secretKey: 's', fetch: doFetch, now: () => NOW.getTime() })
  return { seen, connector: binanceRouteConnector({ client, now: () => NOW }) }
}

describe('the Binance route provider', () => {
  it('serves same-chain swaps on the configured chains, and never a bridge', () => {
    const { connector } = server()
    expect(connector.serves(BSC, BSC)).toBe(true)
    expect(connector.serves(BASE, BASE)).toBe(false)
    expect(connector.serves(BSC, BASE)).toBe(false)
    expect(connector.serves(BSC, 'eip155:1')).toBe(false)
  })

  it('serves whatever chains it is configured for', () => {
    const client = new BinanceClient({ apiKey: 'k', secretKey: 's', fetch: fetch })
    const connector = binanceRouteConnector({ client, chains: [BSC, BASE] })
    expect(connector.serves(BASE, BASE)).toBe(true)
    expect(connector.serves('eip155:1', 'eip155:1')).toBe(false)
    // A chain the registry does not know is not served however it is configured.
    expect(binanceRouteConnector({ client, chains: ['eip155:99999999999'] }).serves('eip155:99999999999', 'eip155:99999999999')).toBe(false)
  })

  it('asks in the provider’s own units, quote then swap, back to back', async () => {
    const { seen, connector } = server()
    await connector.route({ ...swap, slippageBps: 50 })
    expect(seen.map((s) => s.path)).toEqual(['/api/v1/dex/aggregator/quote', '/api/v1/dex/aggregator/swap'])
    const q = seen[0]!.query
    expect(q.get('binanceChainId')).toBe('56')
    expect(q.get('amount')).toBe('10000000000000000000')
    expect(q.get('fromTokenAddress')).toBe(`0x${USDT.slice(2)}`)
    expect(q.get('toTokenAddress')).toBe(`0x${NVDAB.slice(2)}`)
    expect(q.get('userWalletAddress')).toBe('0xd8da6bf26964af9d7eed9e03e53415d37aa96045')
    const s = seen[1]!.query
    expect(s.get('quoteId')).toBe('9ca6e53f664b4450a781d757def09bb9')
    expect(s.get('slippagePercent')).toBe('0.5')
    expect(s.get('userWalletAddress')).toBe('0xd8da6bf26964af9d7eed9e03e53415d37aa96045')
  })

  it('defaults slippage to half a percent and writes basis points the API’s way', async () => {
    const { seen, connector } = server()
    await connector.route(swap)
    expect(seen[1]!.query.get('slippagePercent')).toBe('0.5')
    expect(slippagePercentOf(50)).toBe('0.5')
    expect(slippagePercentOf(100)).toBe('1')
    expect(slippagePercentOf(125)).toBe('1.25')
    expect(slippagePercentOf(5)).toBe('0.05')
    expect(slippagePercentOf(500)).toBe('5')
  })

  it('names the chain’s own currency the way the API does', async () => {
    const { seen, connector } = server({
      quote: envelope([route()]),
      swap: envelope(built({}, { value: '10000000000000000' })),
    })
    await connector.route({ ...swap, fromAsset: `${BSC}/slip44:714`, amountIn: '10000000000000000' })
    expect(seen[0]!.query.get('fromTokenAddress')).toBe('0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE')
  })

  /**
   * The approval is ours: exact, to the contract the quote named, and that
   * contract must be the one the transaction calls.
   */
  it('builds an exact approval to the router, then the router call', async () => {
    const { connector } = server()
    const quote = await connector.route(swap)
    expect(quote.calls).toHaveLength(2)
    const [approve, call] = quote.calls
    expect(approve!.to).toBe(`${BSC}:${USDT}`)
    expect(decoded(approve!.data)).toEqual({ functionName: 'approve', args: [ROUTER, 10000000000000000000n] })
    expect(call).toEqual({ to: `${BSC}:${ROUTER}`, value: '0', data: '0xad43f73dcafe', chainId: BSC })
    expect(quote.approval).toEqual({ spender: `${BSC}:${ROUTER}`, asset: swap.fromAsset, amount: swap.amountIn })
  })

  it('refuses a build whose transaction calls something other than the approved spender', async () => {
    const { connector } = server({ swap: envelope(built({}, { to: '0x000000000000000000000000000000000000dead' })) })
    await expect(connector.route(swap)).rejects.toMatchObject({ code: 'provider_failed' })
    await expect(connector.route(swap)).rejects.toThrow(/spender other than the contract it calls/)
  })

  it('needs no approval for the chain’s own currency, and the value is the amount', async () => {
    const { connector } = server({ swap: envelope(built({}, { value: '10000000000000000' })) })
    const quote = await connector.route({ ...swap, fromAsset: `${BSC}/slip44:714`, amountIn: '10000000000000000' })
    expect(quote.calls).toHaveLength(1)
    expect(quote.calls[0]!.value).toBe('10000000000000000')
    expect(quote.approval).toBeNull()
    expect(quote.nativeFee).toBeNull()
  })

  it('refuses a native swap whose transaction sends a different amount', async () => {
    const { connector } = server({ swap: envelope(built({}, { value: '1' })) })
    await expect(connector.route({ ...swap, fromAsset: `${BSC}/slip44:714`, amountIn: '10000000000000000' })).rejects.toThrow(
      /sending 1 wei/,
    )
  })

  it('declares native value on a token route so verify can hold the calls to it', async () => {
    const { connector } = server({ swap: envelope(built({}, { value: '5000' })) })
    const quote = await connector.route(swap)
    expect(quote.nativeFee).toBe('5000')
  })

  it('reads the floor from the built transaction and the output from the build', async () => {
    const { connector } = server()
    const quote = await connector.route(swap)
    expect(quote.minOut).toBe('43467996063269866')
    expect(quote.expectedOut).toBe('43686428204291323')
    expect(quote.provider).toBe('binance')
    expect(quote.etaSeconds).toBeNull()
  })

  it('refuses a build with no floor rather than promising nothing', async () => {
    const { connector } = server({ swap: envelope(built({}, { minReceiveAmount: undefined })) })
    await expect(connector.route(swap)).rejects.toThrow(/no floor/)
  })

  /**
   * The quote id lives thirty seconds, but it only gates the second call.
   * Once built, the floor is in the calldata, so the plan keeps the usual
   * few minutes.
   */
  it('gives the built route the usual three minutes, not the quote id’s thirty seconds', async () => {
    const { connector } = server()
    const quote = await connector.route(swap)
    expect(quote.expiresAt).toBe('2026-09-23T06:03:00.000Z')
  })

  it('names the venue and the aggregator in the steps, and the fee to the cent', async () => {
    const { connector } = server()
    const quote = await connector.route(swap)
    expect(quote.steps).toEqual(['Swap on Metric via LiquidMesh'])
    expect(quote.feesUsd).toBe('0.02')
  })

  it('picks the route the vendor marked best, not the first', async () => {
    const { seen, connector } = server({
      quote: envelope([route({ quoteId: 'a'.repeat(32), isBest: false, toTokenAmount: '1' }), route({ quoteId: 'b'.repeat(32), isBest: true })]),
    })
    await connector.route(swap)
    expect(seen[1]!.query.get('quoteId')).toBe('b'.repeat(32))
  })

  it('picks the best SWAP quote even when an RFQ quote is marked best overall', async () => {
    const { seen, connector } = server({
      quote: envelope([
        route({ quoteId: 'a'.repeat(32), executionMode: 'RFQ', isBest: true }),
        route({ quoteId: 'b'.repeat(32), executionMode: 'SWAP', isBest: false }),
      ]),
    })
    await connector.route(swap)
    expect(seen[1]!.query.get('quoteId')).toBe('b'.repeat(32))
  })
})

describe('what is not a route here', () => {
  /**
   * An RFQ order is filled by a vendor against a signature and submitted
   * through the API. Neither is a transaction a wallet sends, and the
   * chooser has LI.FI behind this provider for exactly this case.
   */
  it('refuses an RFQ quote as unsupported, so the chooser asks the next provider', async () => {
    const { seen, connector } = server({ quote: envelope([route({ executionMode: 'RFQ' })]) })
    const err = await connector.route(swap).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(RouteError)
    expect(err).toMatchObject({ code: 'unsupported' })
    expect((err as Error).message).toMatch(/RFQ order/)
    // Never built: the swap call is not made for an order.
    expect(seen.map((s) => s.path)).toEqual(['/api/v1/dex/aggregator/quote'])
  })

  it('refuses a build that came back as an order even when the quote did not', async () => {
    const { connector } = server({ swap: envelope(built({ executionMode: 'RFQ', tx: null, rfq: { typedDataToSign: {} } })) })
    await expect(connector.route(swap)).rejects.toMatchObject({ code: 'unsupported' })
  })

  it('is a provider failure, not a crash, when the build comes back with no data', async () => {
    const { connector } = server({ swap: envelope(null) })
    await expect(connector.route(swap)).rejects.toMatchObject({ code: 'provider_failed' })
  })

  it('is no_route when the vendor found no venue', async () => {
    const { connector } = server({
      quote: envelope(null, 40441, 'No valid quote result from any vendor, please retry later'),
    })
    await expect(connector.route(swap)).rejects.toMatchObject({ code: 'no_route' })
  })

  it('is no_route when the vendor answers with no routes at all', async () => {
    const { connector } = server({ quote: envelope([]) })
    await expect(connector.route(swap)).rejects.toMatchObject({ code: 'no_route' })
  })

  it('carries the vendor’s own words on any other refusal, never the key', async () => {
    const { connector } = server({
      quote: envelope(null, 40001, 'Parameter [fromTokenAddress] error: invalid token address'),
    })
    const err = await connector.route(swap).catch((e: unknown) => e)
    expect(err).toMatchObject({ code: 'provider_failed' })
    expect((err as Error).message).toContain('invalid token address')
    expect((err as Error).message).not.toContain('X-OC')
  })

  it('is a provider failure when the key is refused', async () => {
    const { connector } = server({ quote: envelope(null, 40101, 'invalid api key'), status: 401 })
    await expect(connector.route(swap)).rejects.toThrow(/refused the API key/)
  })

  it('quotes by the amount going in only', async () => {
    const { connector } = server()
    await expect(connector.route({ ...swap, amountIn: undefined, amountOut: '1' })).rejects.toMatchObject({ code: 'unsupported' })
  })

  it('sends the output to the signer only', async () => {
    const { connector } = server()
    await expect(
      connector.route({ ...swap, toAccount: `${BSC}:0x000000000000000000000000000000000000dead` }),
    ).rejects.toThrow(/signing wallet only/)
  })

  it('will not bridge, and says so', async () => {
    const { connector } = server()
    await expect(connector.route({ ...swap, toAsset: `${BASE}/slip44:60` })).rejects.toThrow(/does not bridge/)
  })
})
