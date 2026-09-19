import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PlanSummary } from '@/lib/api'
import { liveRequests, pollRequests, type RequestsState } from './poll'

const NOW = Date.parse('2026-09-10T12:00:00Z')
function plan(id: string, expiresIn = 60_000, createdAgo = 0): PlanSummary {
  const createdAt = new Date(NOW - createdAgo).toISOString()
  return {
    id, version: 1, status: 'awaiting_review', kind: 'transfer', summary: 'Send USDC', reason: 'Has funds',
    account: { caip10: 'eip155:8453:0x1' }, chainId: 'eip155:8453', asset: null, toAsset: null, recipient: null, blockedReason: null,
    createdVia: 'agent', createdAt, statusAt: createdAt, expiresAt: new Date(NOW + expiresIn).toISOString(),
    assetIconUrl: null, chainIconUrl: null, valueUsd: null, wallet: null,
  }
}
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers() })

describe('Requests polling', () => {
  it('orders newest first and expires at the boundary without changing the response', () => {
    const rows = [plan('old', 60_000, 10_000), plan('expired', 0), plan('new')]
    expect(liveRequests(rows, NOW).map(p => p.id)).toEqual(['new', 'old'])
    expect(rows).toHaveLength(3)
  })

  it('discovers new plans and removes submitted or cancelled plans when the service drops them', async () => {
    vi.useFakeTimers(); vi.setSystemTime(NOW)
    const read = vi.fn().mockResolvedValueOnce({ plans: [plan('first')] }).mockResolvedValueOnce({ plans: [plan('second')] })
    let state: RequestsState | undefined
    const poll = pollRequests(read, next => { state = next })
    await vi.advanceTimersByTimeAsync(0)
    expect(state?.plans.map(p => p.id)).toEqual(['first'])
    await vi.advanceTimersByTimeAsync(5_000)
    expect(state?.plans.map(p => p.id)).toEqual(['second'])
    expect(read).toHaveBeenCalledTimes(2)
    poll.stop()
  })

  it('keeps last-known rows on failure but removes expired rows between network polls', async () => {
    vi.useFakeTimers(); vi.setSystemTime(NOW)
    const read = vi.fn().mockResolvedValueOnce({ plans: [plan('expires', 6_000), plan('live')] }).mockRejectedValue(new Error('offline'))
    let state: RequestsState | undefined
    const poll = pollRequests(read, next => { state = next })
    await vi.advanceTimersByTimeAsync(5_000)
    expect(state?.failed).toBe(true)
    expect(state?.plans).toHaveLength(2)
    await vi.advanceTimersByTimeAsync(1_000)
    expect(state?.plans.map(p => p.id)).toEqual(['live'])
    poll.stop()
  })

  it('does not overlap slow reads or publish after the user session stops', async () => {
    vi.useFakeTimers(); vi.setSystemTime(NOW)
    let resolve!: (value: { plans: PlanSummary[] }) => void
    const read = vi.fn(() => new Promise<{ plans: PlanSummary[] }>(done => { resolve = done }))
    const publish = vi.fn()
    const poll = pollRequests(read, publish)
    await vi.advanceTimersByTimeAsync(15_000)
    expect(read).toHaveBeenCalledTimes(1)
    poll.stop()
    publish.mockClear()
    resolve({ plans: [plan('old-user')] })
    await vi.advanceTimersByTimeAsync(10_000)
    expect(publish).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('recovers from an initial failure on manual refresh', async () => {
    vi.useFakeTimers(); vi.setSystemTime(NOW)
    const read = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue({ plans: [] })
    let state: RequestsState | undefined
    const poll = pollRequests(read, next => { state = next })
    await vi.advanceTimersByTimeAsync(0)
    expect(state).toMatchObject({ failed: true, loaded: false })
    await poll.refresh()
    expect(state).toEqual({ failed: false, loaded: true, plans: [] })
    poll.stop()
  })
})
