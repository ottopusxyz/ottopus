import { describe, expect, it, vi } from 'vitest'
import type { Call } from '../../core/index.js'
import { LEGACY_PROVIDER, baselineSimulator, executionRefusal, reasonOf } from './baseline.js'
import { asSimulation, composite, gasUsd } from './index.js'
import { SimulationUnavailableError, type SimulationRun, type Simulator } from './types.js'

const BASE = 'eip155:8453'
const ME = `${BASE}:0xd8da6bf26964af9d7eed9e03e53415d37aa96045`
const DEAD = `${BASE}:0x000000000000000000000000000000000000dead`
const calls: Call[] = [{ to: DEAD, value: '1', data: '0x', chainId: BASE }]
const request = { chainId: BASE, account: ME, calls }

function run(over: Partial<SimulationRun> = {}): SimulationRun {
  return {
    provider: 'fake',
    chainId: BASE,
    blockNumber: '51119499',
    success: true,
    gasUsed: '21000',
    assetChanges: [],
    tracedAssets: true,
    ranAt: '2026-09-10T12:00:00.000Z',
    raw: {},
    ...over,
  }
}

const stub = (name: string, answer: () => Promise<SimulationRun>, serves = true): Simulator => ({
  name,
  serves: () => serves,
  simulate: answer,
})

describe('the adapter over several simulators', () => {
  it('takes the first traced answer and asks nobody else', async () => {
    const second = vi.fn(async () => run({ provider: 'second' }))
    const adapter = composite([stub('first', async () => run({ provider: 'first' })), stub('second', second)])
    expect((await adapter.simulate(request)).provider).toBe('first')
    expect(second).not.toHaveBeenCalled()
  })

  /**
   * The asset diff is what the page is for, so a preferred vendor that could
   * not trace balances loses to a plainer one that could. Success and gas
   * agree between them anyway, so nothing is given up by preferring detail.
   */
  it('prefers a traced answer over an untraced one from a preferred vendor', async () => {
    const adapter = composite([
      stub('rich', async () => run({ provider: 'rich', tracedAssets: false })),
      stub('baseline', async () => run({ provider: 'baseline', tracedAssets: true })),
    ])
    expect((await adapter.simulate(request)).provider).toBe('baseline')
  })

  it('returns a refusal immediately, traced or not: a no is the answer', async () => {
    const later = vi.fn(async () => run({ provider: 'later' }))
    const adapter = composite([
      stub('rich', async () => run({ provider: 'rich', success: false, tracedAssets: false, revertReason: 'nope' })),
      stub('later', later),
    ])
    const answer = await adapter.simulate(request)
    expect(answer).toMatchObject({ provider: 'rich', success: false })
    expect(later).not.toHaveBeenCalled()
  })

  it('passes over a simulator that throws and uses the next one', async () => {
    const adapter = composite([
      stub('broken', async () => {
        throw new Error('vendor down')
      }),
      stub('baseline', async () => run({ provider: 'baseline' })),
    ])
    expect((await adapter.simulate(request)).provider).toBe('baseline')
  })

  it('falls back to an untraced answer when the traced one failed outright', async () => {
    const adapter = composite([
      stub('rich', async () => run({ provider: 'rich', tracedAssets: false })),
      stub('broken', async () => {
        throw new Error('down')
      }),
    ])
    expect((await adapter.simulate(request)).provider).toBe('rich')
  })

  it('says unavailable rather than inventing a verdict when nothing serves the chain', async () => {
    const adapter = composite([stub('rich', async () => run(), false)])
    expect(adapter.serves(BASE)).toBe(false)
    await expect(adapter.simulate(request)).rejects.toBeInstanceOf(SimulationUnavailableError)
  })

  it('says unavailable when every simulator that serves the chain failed', async () => {
    const adapter = composite([
      stub('a', async () => {
        throw new Error('one')
      }),
      stub('b', async () => {
        throw new Error('two')
      }),
    ])
    await expect(adapter.simulate(request)).rejects.toThrow(/every simulator failed/)
  })
})

describe('pricing the gas', () => {
  it('multiplies units by the base fee and the currency’s price', () => {
    // 21000 gas at 1 gwei is 0.000021 ETH; at $4,000 that is 8.4 cents.
    expect(gasUsd('21000', { gasPriceWei: '1000000000', nativePriceUsd: 4000, nativeDecimals: 18 })).toBe('0.08')
  })

  it('never says free: a real fee below a cent reads as a cent', () => {
    expect(gasUsd('21000', { gasPriceWei: '1000000', nativePriceUsd: 4000, nativeDecimals: 18 })).toBe('0.01')
  })

  it('is unknown when any input is missing, rather than a made-up number', () => {
    expect(gasUsd('21000', {})).toBe('unknown')
    expect(gasUsd('21000', { gasPriceWei: '1000000000', nativePriceUsd: null, nativeDecimals: 18 })).toBe('unknown')
    expect(gasUsd('21000', { gasPriceWei: null, nativePriceUsd: 4000, nativeDecimals: 18 })).toBe('unknown')
  })

  it('carries cents through without a float', () => {
    expect(gasUsd('1000000', { gasPriceWei: '1000000000', nativePriceUsd: 4321.99, nativeDecimals: 18 })).toBe('4.32')
  })
})

describe('shaping a run for the plan', () => {
  it('keeps the conclusions and the trace flag, prices the gas, and drops the vendor’s body', () => {
    const simulation = asSimulation(
      run({ raw: { resultHash: 'b'.repeat(64), baseFeePerGas: '1000000000' } }),
      { gasPriceWei: '1000000000', nativePriceUsd: 4000, nativeDecimals: 18 },
    )
    expect(simulation).toEqual({
      provider: 'fake',
      chainId: BASE,
      blockNumber: '51119499',
      success: true,
      assetChanges: [],
      // Carried through, not dropped: the custom tier refuses a run that never looked.
      tracedAssets: true,
      gasUsed: '21000',
      gasUsd: '0.08',
      resultHash: 'b'.repeat(64),
      ranAt: '2026-09-10T12:00:00.000Z',
    })
  })

  it('carries a revert reason and which call it came from', () => {
    const simulation = asSimulation(run({ success: false, revertReason: 'ERC20: transfer amount exceeds balance', failedCall: 1 }))
    expect(simulation).toMatchObject({ success: false, failedCall: 1, gasUsd: 'unknown' })
  })
})

describe('reading an error', () => {
  it('takes the contract’s own revert string, not viem’s lead-in', () => {
    const err = { shortMessage: 'The contract function "<unknown>" reverted with the following reason:\nERC20: transfer amount exceeds balance' }
    expect(reasonOf(err)).toBe('ERC20: transfer amount exceeds balance')
  })

  it('says so plainly when a call reverted without a reason', () => {
    expect(reasonOf({ shortMessage: 'The contract function "<unknown>" reverted with the following reason:' })).toBe(
      'the call reverted without giving a reason',
    )
  })

  /** The URL carries the API key. A reason is a nicety; a leaked key is not worth one. */
  it('drops anything that still looks like a request', () => {
    expect(reasonOf({ shortMessage: 'HTTP request failed: https://base-mainnet.g.alchemy.com/v2/secret' })).toBe(
      'the call reverted',
    )
  })

  it('caps a long reason', () => {
    expect(reasonOf({ shortMessage: 'x'.repeat(400) })).toHaveLength(200)
  })

  it('turns the chain’s refusals into sentences about the account', () => {
    expect(executionRefusal({ details: 'insufficient funds for gas * price + value: have 0 want 1' })).toBe(
      'the account cannot cover the amount plus gas on this chain',
    )
    expect(executionRefusal({ details: 'nonce too low' })).toBe('the account nonce has moved')
    expect(executionRefusal({ details: 'ERC20: transfer amount exceeds balance' })).toBeNull()
  })

  it('finds a refusal nested in a cause', () => {
    expect(executionRefusal({ name: 'CallExecutionError', cause: { details: 'insufficient funds' } })).not.toBeNull()
  })
})

/**
 * The last resort: a node that has never heard of eth_simulateV1. The answer
 * is thinner — no balances traced — and it still has to be an answer, because
 * a plan with no simulation tells the reviewer less than a plan with a plain
 * one.
 */
describe('a node without eth_simulateV1', () => {
  const rpc = (answers: Record<string, unknown>): typeof fetch =>
    (async (_url: unknown, init?: { body?: string }) => {
      const { method, id } = JSON.parse(init?.body ?? '{}') as { method: string; id: number }
      const answer = answers[method]
      const body =
        answer === undefined
          ? { id, jsonrpc: '2.0', error: { code: -32601, message: 'the method eth_simulateV1 does not exist' } }
          : { id, jsonrpc: '2.0', result: answer }
      return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
    }) as unknown as typeof fetch

  it('falls back to eth_call and eth_estimateGas, and says the balances were not traced', async () => {
    const simulator = baselineSimulator({
      fetch: rpc({ eth_blockNumber: '0x30c0fe7', eth_call: '0x', eth_estimateGas: '0x5208' }),
      now: () => new Date('2026-09-10T12:00:00Z'),
    })
    const answer = await simulator.simulate(request)
    expect(answer).toMatchObject({
      provider: LEGACY_PROVIDER,
      success: true,
      gasUsed: '21000',
      tracedAssets: false,
      assetChanges: [],
      blockNumber: '51122151',
    })
  })

  it('reports a revert from the fallback with the call that caused it', async () => {
    const simulator = baselineSimulator({
      fetch: rpc({ eth_blockNumber: '0x30c0fe7' }),
      now: () => new Date('2026-09-10T12:00:00Z'),
    })
    const answer = await simulator.simulate(request)
    expect(answer.success).toBe(false)
    expect(answer.failedCall).toBe(1)
  })
})
