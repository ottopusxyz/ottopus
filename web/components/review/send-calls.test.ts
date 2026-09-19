import { describe, expect, it } from 'vitest'
import { BatchAccepted, SequentialNeedsConsent, sendPlanCalls } from './send-calls'

/**
 * The provider answered from memory. What is under test is the one rule that
 * matters: once a wallet has accepted the calls, they are never offered again
 * through another method, whatever goes wrong afterwards.
 */
const CHAIN = 'eip155:8453'
const FROM = '0x958543756a4c7ac6fb361f0efbfecd98e4d297db'
const CALL = { to: `${CHAIN}:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913`, value: '0', data: '0xa9059cbb', chainId: CHAIN }

function provider(script: Record<string, (params: unknown[]) => unknown>) {
  const calls: string[] = []
  return {
    calls,
    async request({ method, params = [] }: { method: string; params?: unknown[] }) {
      calls.push(method)
      const handler = script[method]
      if (!handler) throw Object.assign(new Error(`${method} not supported`), { code: -32601 })
      return handler(params)
    },
  }
}

const batching = { wallet_getCapabilities: () => ({ '0x2105': { atomic: { status: 'supported' } } }) }

describe('an accepted batch is never sent twice', () => {
  it('does not fall back to eth_sendTransaction when the status poll throws', async () => {
    const p = provider({
      ...batching,
      wallet_sendCalls: () => ({ id: 'batch-1' }),
      wallet_getCallsStatus: () => {
        throw Object.assign(new Error('internal'), { code: -32603 })
      },
      eth_sendTransaction: () => '0x' + 'aa'.repeat(32),
    })
    const attempt = sendPlanCalls({ provider: p, from: FROM, chainId: CHAIN, calls: [CALL], sequentialIsSafe: true })
    await expect(attempt).rejects.toBeInstanceOf(BatchAccepted)
    await expect(attempt).rejects.toMatchObject({ batchId: 'batch-1' })
    expect(p.calls).not.toContain('eth_sendTransaction')
  })

  it('does not fall back when the wallet reports the batch failed', async () => {
    const p = provider({
      ...batching,
      wallet_sendCalls: () => ({ id: 'batch-2' }),
      wallet_getCallsStatus: () => ({ status: 500 }),
      eth_sendTransaction: () => '0x' + 'aa'.repeat(32),
    })
    await expect(sendPlanCalls({ provider: p, from: FROM, chainId: CHAIN, calls: [CALL], sequentialIsSafe: true })).rejects.toBeInstanceOf(BatchAccepted)
    expect(p.calls).not.toContain('eth_sendTransaction')
  })

  it('returns the hash once the batch names one', async () => {
    let asked = 0
    const p = provider({
      ...batching,
      wallet_sendCalls: () => ({ id: 'batch-3' }),
      wallet_getCallsStatus: () => (asked++ === 0 ? { status: 100 } : { status: 200, receipts: [{ transactionHash: '0x' + 'bb'.repeat(32) }] }),
    })
    const sent = await sendPlanCalls({ provider: p, from: FROM, chainId: CHAIN, calls: [CALL], sequentialIsSafe: true })
    expect(sent).toEqual({ txHash: '0x' + 'bb'.repeat(32), method: 'sendCalls' })
  })
})

describe('falling back is only for a wallet that refused before accepting', () => {
  it('sends sequentially when wallet_sendCalls itself is unsupported and one call is safe', async () => {
    const p = provider({
      ...batching,
      wallet_sendCalls: () => {
        throw Object.assign(new Error('unsupported'), { code: 4200 })
      },
      eth_sendTransaction: () => '0x' + 'cc'.repeat(32),
    })
    const sent = await sendPlanCalls({ provider: p, from: FROM, chainId: CHAIN, calls: [CALL], sequentialIsSafe: true })
    expect(sent.method).toBe('sequential')
    expect(p.calls.filter((m) => m === 'eth_sendTransaction')).toHaveLength(1)
  })

  it('refuses the sequential path when it could leave an approval standing', async () => {
    const p = provider({
      wallet_getCapabilities: () => ({}),
      eth_sendTransaction: () => '0x' + 'dd'.repeat(32),
    })
    await expect(sendPlanCalls({ provider: p, from: FROM, chainId: CHAIN, calls: [CALL, CALL], sequentialIsSafe: false })).rejects.toBeInstanceOf(SequentialNeedsConsent)
    expect(p.calls).not.toContain('eth_sendTransaction')
  })
})
