import { describe, expect, it } from 'vitest'
import { type Plan, assemblePlan, planDraftSchema } from '../../core/index.js'
import { BinanceClient } from '../binance/index.js'
import type { TokenRegistry } from '../tokens/index.js'
import { binanceSimulator } from './binance.js'

const BSC = 'eip155:56'
const ME = '0xd8da6bf26964af9d7eed9e03e53415d37aa96045'
const USDT = '0x55d398326f99059ff775485246999027b3197955'
const NVDAB = '0x02fca66c1d1afb4e2a7884261eb00f63598a7436'
const ROUTER = '0xb44446b0c8e56988c34f7ff73ae904982b5fdda5'
const NOW = new Date('2026-09-26T10:00:00Z')

/** A swap plan on BNB Chain: an exact approval, then the router. */
function plan(calls: Plan['outcome'] extends { calls: infer C } ? C : never): Plan {
  const expiresAt = new Date(NOW.getTime() + 15 * 60_000).toISOString()
  return assemblePlan(
    planDraftSchema.parse({
      id: '5c1f2f3a-9d5e-4d7a-8f8a-1b2c3d4e5f60',
      version: 1,
      userId: '7a8b9c0d-1e2f-4a3b-8c4d-5e6f7a8b9c0d',
      createdVia: 'agent',
      intent: { kind: 'swap', from: `${BSC}/erc20:${USDT}`, to: `${BSC}/erc20:${NVDAB}`, amountIn: '50000000000000000000' },
      provenance: 'route_provider',
      resolution: { account: { caip10: `${BSC}:${ME}`, label: 'Main' }, candidatesConsidered: [], reason: 'only funded account' },
      outcome: { type: 'calls', calls },
      quote: { provider: 'binance', expiresAt },
      humanPlan: { summary: 'Swap 50 USDT for NVDAB', steps: ['Approve', 'Swap'], feesUsd: '0.02', warnings: [] },
      status: 'awaiting_review',
      expiresAt,
    }),
  )
}

const approve = { to: `${BSC}:${USDT}`, value: '0', data: '0x095ea7b3cafe', chainId: BSC }
const swap = { to: `${BSC}:${ROUTER}`, value: '0', data: '0xad43f73dcafe', chainId: BSC }

const envelope = (data: unknown, code = 0, msg = 'success') => ({ code, msg, data, success: code === 0 })

/** What the vendor answered live on 2026-09-26. */
const success = (over: Record<string, unknown> = {}) => ({
  status: 'SUCCESS',
  failReason: '',
  balanceChanges: [],
  allowanceChanges: [],
  ...over,
})
const failed = (failReason: string) => ({ status: 'FAILED', failReason, balanceChanges: [], allowanceChanges: [] })

/** A fake vendor behind the real signed client, answering from a script and recording each body. */
function server(answers: unknown[], status = 200) {
  const seen: Record<string, unknown>[] = []
  const doFetch = (async (_url: unknown, init: { body?: string }) => {
    seen.push(JSON.parse(init.body ?? '{}') as Record<string, unknown>)
    const body = answers[Math.min(seen.length, answers.length) - 1]
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
  }) as unknown as typeof fetch
  const client = new BinanceClient({ apiKey: 'k', secretKey: 's', fetch: doFetch, now: () => NOW.getTime() })
  return { seen, client }
}

const registry: TokenRegistry = {
  name: 'test',
  async byAssetId(assetId) {
    if (assetId === `${BSC}/erc20:${USDT}`) return { assetId, symbol: 'USDT', name: 'Tether', decimals: 18, iconUrl: null, priceUsd: 1, verified: true }
    if (assetId === `${BSC}/erc20:${NVDAB}`) return { assetId, symbol: 'NVDAB', name: 'NVIDIA', decimals: 18, iconUrl: null, priceUsd: 224, verified: true }
    return null
  },
  async find() {
    return null
  },
}

describe('the Binance simulation', () => {
  it('posts each call alone, in order, as the vendor’s evmTx on the plan’s chain', async () => {
    const { seen, client } = server([envelope(success())])
    const simulate = binanceSimulator({ client, tokens: registry, now: () => NOW })
    const answer = await simulate(plan([approve, swap]))
    expect(answer.status).toBe('SUCCESS')
    expect(seen).toEqual([
      { binanceChainId: '56', evmTx: { from: ME, to: USDT, value: '0', data: approve.data } },
      { binanceChainId: '56', evmTx: { from: ME, to: ROUTER, value: '0', data: swap.data } },
    ])
    expect(answer.ranAt).toBe(NOW.toISOString())
    expect(answer.provider).toBe('binance')
  })

  it('maps a success body to asset rows, worded from the registry and the chain, biggest first', async () => {
    const { client } = server([
      envelope(success({ allowanceChanges: [{ tokenAddress: USDT.toUpperCase(), owner: ME, spender: ROUTER.toUpperCase(), preAmount: '0', postAmount: '50000000000000000000' }] })),
      envelope(
        success({
          balanceChanges: [
            { contractAddress: '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee', tokenType: 'Native', change: '-1000', owner: ME },
            { contractAddress: USDT, tokenType: 'ERC20', change: '-50000000000000000000', owner: ME },
            { contractAddress: NVDAB, tokenType: 'ERC20', change: '222000000000000000', owner: ME },
            // Not this wallet's change, whatever the vendor says it is.
            { contractAddress: USDT, tokenType: 'ERC20', change: '50000000000000000000', owner: ROUTER },
          ],
        }),
      ),
    ])
    const answer = await binanceSimulator({ client, tokens: registry, now: () => NOW })(plan([approve, swap]))
    expect(answer.status).toBe('SUCCESS')
    expect(answer.failReason).toBeNull()
    expect(answer.balanceChanges).toEqual([
      { assetId: `${BSC}/erc20:${USDT}`, symbol: 'USDT', decimals: 18, diff: '-50000000000000000000' },
      { assetId: `${BSC}/erc20:${NVDAB}`, symbol: 'NVDAB', decimals: 18, diff: '222000000000000000' },
      { assetId: `${BSC}/slip44:714`, symbol: 'BNB', decimals: 18, diff: '-1000' },
    ])
    expect(answer.allowanceChanges).toEqual([
      { tokenAddress: USDT, spender: ROUTER, preAmount: '0', postAmount: '50000000000000000000' },
    ])
    // Nothing the plan format could mistake for evidence.
    expect(JSON.stringify(answer)).not.toContain('"pre"')
  })

  it('sums the same asset across calls and drops what nets to nothing', async () => {
    const { client } = server([
      envelope(success({ balanceChanges: [{ contractAddress: USDT, tokenType: 'ERC20', change: '-5', owner: ME }] })),
      envelope(success({ balanceChanges: [{ contractAddress: USDT, tokenType: 'ERC20', change: '5', owner: ME }, { contractAddress: NVDAB, tokenType: 'ERC20', change: '1', owner: ME }] })),
    ])
    const answer = await binanceSimulator({ client, tokens: null, now: () => NOW })(plan([approve, swap]))
    expect(answer.balanceChanges).toEqual([{ assetId: `${BSC}/erc20:${NVDAB}`, symbol: null, decimals: null, diff: '1' }])
  })

  it('carries the vendor’s reason on FAILED, naming the call, and stops there', async () => {
    const { seen, client } = server([
      envelope(success()),
      envelope(failed('execution reverted: BEP20: transfer amount exceeds allowance')),
    ])
    const answer = await binanceSimulator({ client, now: () => NOW })(plan([approve, swap]))
    expect(answer).toMatchObject({
      status: 'FAILED',
      failReason: 'call 2 of 2: execution reverted: BEP20: transfer amount exceeds allowance',
      failedCall: 2,
      balanceChanges: [],
    })
    expect(seen).toHaveLength(2)
  })

  it('names no call when the plan is one call', async () => {
    const { client } = server([envelope(failed('execution reverted: BEP20: transfer amount exceeds balance'))])
    const answer = await binanceSimulator({ client, now: () => NOW })(plan([swap]))
    expect(answer.failReason).toBe('execution reverted: BEP20: transfer amount exceeds balance')
    expect(answer.failedCall).toBe(1)
  })

  it('is unavailable without a credential, and says so', async () => {
    const answer = await binanceSimulator({ client: null, now: () => NOW })(plan([swap]))
    expect(answer).toEqual({
      provider: 'binance',
      status: 'unavailable',
      failReason: 'no Binance credential is configured',
      failedCall: null,
      balanceChanges: [],
      allowanceChanges: [],
      ranAt: NOW.toISOString(),
    })
  })

  it('is unavailable on a chain the vendor does not serve, in a sentence', async () => {
    const { client } = server([envelope(null, 40411, 'This chain is not supported')])
    const answer = await binanceSimulator({ client, now: () => NOW })(plan([swap]))
    expect(answer.status).toBe('unavailable')
    expect(answer.failReason).toBe('Binance does not simulate on this chain')
  })

  it('is unavailable when the vendor cannot be reached, never an error', async () => {
    const doFetch = (async () => {
      throw new TypeError('fetch failed')
    }) as unknown as typeof fetch
    const client = new BinanceClient({ apiKey: 'k', secretKey: 's', fetch: doFetch, now: () => NOW.getTime() })
    const answer = await binanceSimulator({ client, now: () => NOW })(plan([swap]))
    expect(answer.status).toBe('unavailable')
    expect(answer.failReason).toBe('Binance could not be reached: binance could not be reached')
  })
})
