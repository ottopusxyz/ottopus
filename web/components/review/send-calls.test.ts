import { getAddress } from 'viem'
import { describe, expect, it } from 'vitest'
import { BatchAccepted, SequentialNeedsConsent, probeBatching, sendPlanCalls } from './send-calls'

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

/**
 * Deliberately empty. Nothing asks `wallet_getCapabilities` any more: the
 * batch is attempted and the wallet's own refusal decides. A wallet in this
 * script that answers `wallet_sendCalls` batches; one that does not, does not.
 */
const batching = {}

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

/**
 * A Safe answered `wallet_sendCalls` with "Invalid from address".
 *
 * Everything inside Ottopus stores EVM addresses lowercased, which is right
 * for a lookup key and wrong for a wallet: a strict EIP-55 validator rejects
 * an unchecksummed address outright. Checksummed is accepted everywhere.
 */
describe('addresses handed to the wallet', () => {
  const TOKEN = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913'

  it('are checksummed in a batch, both the sender and every target', async () => {
    let sent: { from?: string; calls?: { to?: string }[] } | undefined
    const p = provider({
      ...batching,
      wallet_sendCalls: (params) => {
        sent = params[0] as typeof sent
        return { id: 'batch-1' }
      },
      wallet_getCallsStatus: () => ({ status: 200, receipts: [{ transactionHash: '0x' + 'ab'.repeat(32) }] }),
    })
    await sendPlanCalls({ provider: p, from: FROM, chainId: CHAIN, calls: [CALL], sequentialIsSafe: true })

    expect(sent?.from).toBe(getAddress(FROM))
    expect(sent?.from).not.toBe(FROM)
    expect(sent?.calls?.[0]?.to).toBe(getAddress(TOKEN))
  })

  it('are checksummed one at a time too, which is the same wallet’s other path', async () => {
    let sent: { from?: string; to?: string } | undefined
    const p = provider({
      eth_sendTransaction: (params) => {
        sent = params[0] as typeof sent
        return '0x' + 'cd'.repeat(32)
      },
    })
    await sendPlanCalls({ provider: p, from: FROM, chainId: CHAIN, calls: [CALL], sequentialIsSafe: true })
    expect(sent?.from).toBe(getAddress(FROM))
    expect(sent?.to).toBe(getAddress(TOKEN))
  })

  it('refuse to hand over something that is not an address at all', async () => {
    const p = provider({ eth_sendTransaction: () => '0x' + 'cd'.repeat(32) })
    const attempt = sendPlanCalls({ provider: p, from: 'not-an-address', chainId: CHAIN, calls: [CALL], sequentialIsSafe: true })
    await expect(attempt).rejects.toThrow(/is not an address this wallet can be given/)
  })
})

describe('deciding whether to batch', () => {
  /**
   * An Ambire account that batches in other apps was told to sign one at a
   * time. The gate was `wallet_getCapabilities`, and every way that call can
   * go wrong — forwarded to an RPC node, not passed through by the provider,
   * keyed differently, rate-limited — came back as a plain false and looked
   * exactly like a wallet that cannot batch.
   */
  it('never asks whether the wallet can batch', async () => {
    const p = provider({
      wallet_sendCalls: () => ({ id: 'batch-1' }),
      wallet_getCallsStatus: () => ({ status: 200, receipts: [{ transactionHash: '0x' + 'ab'.repeat(32) }] }),
    })
    const sent = await sendPlanCalls({ provider: p, from: FROM, chainId: CHAIN, calls: [CALL], sequentialIsSafe: true })
    expect(sent.method).toBe('sendCalls')
    expect(p.calls).not.toContain('wallet_getCapabilities')
  })

  it('batches even when the wallet would have answered no', async () => {
    const p = provider({
      wallet_getCapabilities: () => ({}),
      wallet_sendCalls: () => ({ id: 'batch-2' }),
      wallet_getCallsStatus: () => ({ status: 200, receipts: [{ transactionHash: '0x' + 'cd'.repeat(32) }] }),
    })
    const sent = await sendPlanCalls({ provider: p, from: FROM, chainId: CHAIN, calls: [CALL], sequentialIsSafe: true })
    expect(sent.method).toBe('sendCalls')
  })

  it('falls back only when the wallet refuses the method itself', async () => {
    const p = provider({ eth_sendTransaction: () => '0x' + 'ef'.repeat(32) })
    const sent = await sendPlanCalls({ provider: p, from: FROM, chainId: CHAIN, calls: [CALL], sequentialIsSafe: true })
    expect(sent.method).toBe('sequential')
    expect(p.calls[0]).toBe('wallet_sendCalls')
  })

  /** A wallet that fails for its own reasons is not a wallet that cannot batch. */
  it('does not quietly send one at a time when the batch fails for another reason', async () => {
    const p = provider({
      wallet_sendCalls: () => {
        throw Object.assign(new Error('insufficient funds'), { code: -32000 })
      },
      eth_sendTransaction: () => '0x' + 'ab'.repeat(32),
    })
    await expect(
      sendPlanCalls({ provider: p, from: FROM, chainId: CHAIN, calls: [CALL], sequentialIsSafe: true }),
    ).rejects.toThrow(/insufficient funds/)
    expect(p.calls).not.toContain('eth_sendTransaction')
  })
})

/**
 * Read for the label and nothing else. It was a boolean gating the send path,
 * and every way the call can fail collapsed into "cannot batch" and took the
 * feature with it. Three states keep "could not ask" apart from "no".
 */
describe('asking the wallet whether it batches', () => {
  const caps = (body: unknown) => provider({ wallet_getCapabilities: () => body })

  it('reads yes from either spelling, and from a 7702 account that would upgrade', async () => {
    for (const body of [
      { '0x2105': { atomic: { status: 'supported' } } },
      { '0x2105': { atomic: { status: 'ready' } } },
      { '0x2105': { atomicBatch: { supported: true } } },
      // Keyed in decimal by a wallet that writes it that way.
      { '8453': { atomic: { status: 'supported' } } },
      // Answered flat, for the one chain it was asked about.
      { atomic: { status: 'supported' } },
    ]) {
      expect(await probeBatching(caps(body), FROM, CHAIN), JSON.stringify(body)).toBe('yes')
    }
  })

  it('reads no only when the wallet actually said no', async () => {
    expect(await probeBatching(caps({ '0x2105': { atomic: { status: 'unsupported' } } }), FROM, CHAIN)).toBe('no')
    expect(await probeBatching(caps({ '0x2105': { atomicBatch: { supported: false } } }), FROM, CHAIN)).toBe('no')
  })

  it('says unknown rather than no when it could not be asked', async () => {
    expect(await probeBatching(provider({}), FROM, CHAIN)).toBe('unknown')
    expect(await probeBatching(caps({}), FROM, CHAIN)).toBe('unknown')
    expect(await probeBatching(caps({ '0xa4b1': { atomic: { status: 'supported' } } }), FROM, CHAIN)).toBe('unknown')
  })

  /** The casing that made a Safe refuse `wallet_sendCalls` outright. */
  it('asks with a checksummed address', async () => {
    let asked: unknown[] = []
    const p = {
      async request({ params = [] }: { method: string; params?: unknown[] }) {
        asked = params
        return { '0x2105': { atomic: { status: 'supported' } } }
      },
    }
    await probeBatching(p, FROM, CHAIN)
    expect(asked[0]).toBe(getAddress(FROM))
    expect(asked[1]).toEqual(['0x2105'])
  })

  it('is not consulted when sending', async () => {
    const p = provider({
      wallet_getCapabilities: () => ({ '0x2105': { atomic: { status: 'unsupported' } } }),
      wallet_sendCalls: () => ({ id: 'batch-3' }),
      wallet_getCallsStatus: () => ({ status: 200, receipts: [{ transactionHash: '0x' + 'ab'.repeat(32) }] }),
    })
    // The wallet says no and the batch is offered anyway; its refusal, not
    // its opinion, is what decides.
    const sent = await sendPlanCalls({ provider: p, from: FROM, chainId: CHAIN, calls: [CALL], sequentialIsSafe: true })
    expect(sent.method).toBe('sendCalls')
    expect(p.calls).not.toContain('wallet_getCapabilities')
  })
})
