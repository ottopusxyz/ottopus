import { describe, expect, it } from 'vitest'
import { PlanError, type PlanRecord, type TransitionInput } from '../plans/index.js'
import { planFor } from '../plans/fixtures.js'
import { RpcReadError } from '../verify/index.js'
import { BACKOFF_BASE_MS, BACKOFF_MAX_MS, type ReceiptOutcome, ReceiptWatcher } from './receipts.js'

const USER = '0191a2b3-c4d5-4e6f-8a9b-0c1d2e3f4a5b'
const TX = `0x${'cd'.repeat(32)}`
const T0 = Date.parse('2026-09-10T12:00:00Z')

function submitted(over: Partial<PlanRecord> = {}): PlanRecord {
  return {
    plan: planFor(USER, { status: 'submitted' }),
    walletId: 'w1',
    grantId: null,
    createdAt: new Date(T0 - 60_000).toISOString(),
    statusAt: new Date(T0).toISOString(),
    statusDetail: { txHash: TX },
    ...over,
  }
}

/** A watcher over an in-memory store, with the chain's answer and the clock in the test's hands. */
function harness(records: PlanRecord[], answer: () => Promise<ReceiptOutcome | null>) {
  let clock = T0
  const moves: TransitionInput[] = []
  let reads = 0
  const watcher = new ReceiptWatcher({
    listSubmitted: async () => records.filter((r) => r.plan.status === 'submitted'),
    transition: async (input) => {
      moves.push(input)
      const record = records.find((r) => r.plan.id === input.planId)
      if (record) record.plan.status = input.to
      return input.to
    },
    reader: {
      receipt: async () => {
        reads += 1
        return answer()
      },
    },
    now: () => clock,
  })
  return { watcher, moves, reads: () => reads, advance: (ms: number) => (clock += ms) }
}

describe('the receipt watcher', () => {
  it('confirms a mined transaction and carries the hash onto the event', async () => {
    const record = submitted()
    const { watcher, moves } = harness([record], async () => 'success')
    const report = await watcher.tick()
    expect(report).toMatchObject({ watched: 1, checked: 1, confirmed: 1, failed: 0 })
    expect(moves).toEqual([
      { userId: USER, planId: record.plan.id, version: 1, to: 'confirmed', detail: { txHash: TX } },
    ])
    // Once written, there is nothing left to watch.
    expect(await watcher.tick()).toMatchObject({ watched: 0 })
  })

  it('fails a reverted transaction and says why', async () => {
    const record = submitted()
    const { watcher, moves } = harness([record], async () => 'reverted')
    await watcher.tick()
    expect(moves[0]).toMatchObject({ to: 'failed', detail: { txHash: TX, reason: 'reverted' } })
  })

  it('backs off while the chain has no receipt, doubling up to a cap', async () => {
    const { watcher, moves, reads, advance } = harness([submitted()], async () => null)
    await watcher.tick()
    expect(reads()).toBe(1)
    // Not due yet: the tick is free.
    await watcher.tick()
    expect(reads()).toBe(1)
    advance(BACKOFF_BASE_MS)
    await watcher.tick()
    expect(reads()).toBe(2)
    advance(BACKOFF_BASE_MS)
    await watcher.tick()
    expect(reads(), 'second wait is twice the first').toBe(2)
    advance(BACKOFF_BASE_MS)
    await watcher.tick()
    expect(reads()).toBe(3)
    // Ten misses in, the wait is the cap and no longer grows.
    for (let i = 0; i < 10; i += 1) {
      advance(BACKOFF_MAX_MS)
      await watcher.tick()
    }
    expect(reads()).toBe(13)
    expect(moves).toEqual([])
  })

  it('treats a chain it cannot read as a miss, not an outcome', async () => {
    const { watcher, moves, reads, advance } = harness([submitted()], async () => {
      throw new RpcReadError('eip155:8453', new Error('boom'))
    })
    const report = await watcher.tick()
    expect(report.errors).toBe(1)
    expect(moves).toEqual([])
    advance(BACKOFF_BASE_MS)
    await watcher.tick()
    expect(reads()).toBe(2)
  })

  describe('a submission older than a day', () => {
    const DAY = 24 * 60 * 60_000
    const stale = () => submitted({ statusAt: new Date(T0 - DAY - 60 * 60_000).toISOString() })

    it('is dropped only once the chain has answered that it never saw the hash', async () => {
      const { watcher, moves, reads } = harness([stale()], async () => null)
      const report = await watcher.tick()
      expect(reads(), 'the chain is asked before any verdict').toBe(1)
      expect(report.dropped).toBe(1)
      expect(moves[0]).toMatchObject({ to: 'failed', detail: { txHash: TX, reason: 'dropped' } })
    })

    it('is confirmed when a receipt turns up, however late — after downtime, say', async () => {
      const { watcher, moves } = harness([stale()], async () => 'success')
      const report = await watcher.tick()
      expect(report).toMatchObject({ confirmed: 1, dropped: 0 })
      expect(moves[0]).toMatchObject({ to: 'confirmed', detail: { txHash: TX } })
    })

    it('is left alone while the chain cannot be read: an outage is not a verdict', async () => {
      const { watcher, moves, advance, reads } = harness([stale()], async () => {
        throw new RpcReadError('eip155:8453', new Error('provider down'))
      })
      const report = await watcher.tick()
      expect(report).toMatchObject({ errors: 1, dropped: 0 })
      expect(moves).toEqual([])
      advance(BACKOFF_BASE_MS)
      await watcher.tick()
      expect(reads(), 'and it is asked again').toBe(2)
    })
  })

  it('accepts a refusal as the browser having written the outcome first', async () => {
    const record = submitted()
    let refused = 0
    const watcher = new ReceiptWatcher({
      listSubmitted: async () => [record],
      transition: async () => {
        refused += 1
        throw new PlanError('illegal_transition', 'confirmed -> confirmed is not allowed')
      },
      reader: { receipt: async () => 'success' },
      now: () => T0,
    })
    await expect(watcher.tick()).resolves.toMatchObject({ confirmed: 1 })
    expect(refused).toBe(1)
  })

  it('polls each plan on its own clock', async () => {
    const a = submitted()
    const b = submitted()
    const answers = new Map<string, ReceiptOutcome | null>([[a.plan.id, null], [b.plan.id, null]])
    let clock = T0
    const reads: string[] = []
    const watcher = new ReceiptWatcher({
      listSubmitted: async () => [a, b].filter((r) => r.plan.status === 'submitted'),
      transition: async (input) => {
        ;(input.planId === a.plan.id ? a : b).plan.status = input.to
        return input.to
      },
      reader: {
        receipt: async (_chain, hash) => {
          const record = [a, b].find((r) => r.statusDetail?.txHash === hash)!
          reads.push(record.plan.id)
          return answers.get(record.plan.id) ?? null
        },
      },
      now: () => clock,
    })
    a.statusDetail = { txHash: `0x${'aa'.repeat(32)}` }
    b.statusDetail = { txHash: `0x${'bb'.repeat(32)}` }
    await watcher.tick()
    expect(reads).toEqual([a.plan.id, b.plan.id])
    answers.set(a.plan.id, 'success')
    clock += BACKOFF_BASE_MS
    await watcher.tick()
    expect(a.plan.status).toBe('confirmed')
    expect(b.plan.status).toBe('submitted')
    // b is on its second wait; a is gone.
    clock += BACKOFF_BASE_MS
    await watcher.tick()
    expect(reads.filter((id) => id === a.plan.id)).toHaveLength(2)
  })
})
