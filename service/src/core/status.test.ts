import { describe, expect, it } from 'vitest'
import { PLAN_STATUSES, TERMINAL_STATUSES, isTerminal } from './plan.js'
import { PENDING_STATUSES, PLAN_TRANSITIONS, canTransition, effectiveStatus, isPending } from './status.js'

describe('the transition table', () => {
  it('has a row for every status, and only for statuses', () => {
    expect(Object.keys(PLAN_TRANSITIONS).sort()).toEqual([...PLAN_STATUSES].sort())
    for (const targets of Object.values(PLAN_TRANSITIONS)) {
      for (const t of targets) expect(PLAN_STATUSES).toContain(t)
    }
  })

  it('never leaves a terminal state', () => {
    for (const from of TERMINAL_STATUSES) {
      for (const to of PLAN_STATUSES) expect(canTransition(from, to), `${from} -> ${to}`).toBe(false)
    }
  })

  it('never lets a status transition to itself', () => {
    for (const s of PLAN_STATUSES) expect(canTransition(s, s)).toBe(false)
  })

  it('can reach every terminal state from somewhere', () => {
    for (const to of TERMINAL_STATUSES) {
      const reachable = PLAN_STATUSES.some((from) => canTransition(from, to))
      expect(reachable, `nothing leads to ${to}`).toBe(true)
    }
  })

  /** Once on chain, our side has no say: no cancel, no expiry, no re-plan. */
  it('lets a submitted plan only confirm or fail', () => {
    expect(PLAN_TRANSITIONS.submitted).toEqual(['confirmed', 'failed'])
  })

  it('walks the happy path', () => {
    expect(canTransition('draft', 'awaiting_review')).toBe(true)
    expect(canTransition('awaiting_review', 'awaiting_signature')).toBe(true)
    expect(canTransition('awaiting_signature', 'submitted')).toBe(true)
    expect(canTransition('submitted', 'confirmed')).toBe(true)
  })

  it('refuses to skip review', () => {
    expect(canTransition('draft', 'awaiting_signature')).toBe(false)
    expect(canTransition('draft', 'submitted')).toBe(false)
    expect(canTransition('awaiting_review', 'submitted')).toBe(false)
  })

  it('lets a disconnected wallet fall back to review', () => {
    expect(canTransition('awaiting_signature', 'awaiting_review')).toBe(true)
  })
})

describe('pending', () => {
  it('means waiting on a person, and nothing terminal', () => {
    for (const s of PENDING_STATUSES) expect(isTerminal(s)).toBe(false)
    expect(isPending('draft')).toBe(false)
    expect(isPending('submitted')).toBe(false)
    expect(isPending('awaiting_review')).toBe(true)
    expect(isPending('awaiting_signature')).toBe(true)
  })
})

describe('derived expiry', () => {
  const now = new Date('2026-09-09T12:00:00Z')
  const before = '2026-09-09T11:59:59Z'
  const after = '2026-09-09T12:00:01Z'

  it('reads a pending plan past its expiry as expired, without an event', () => {
    expect(effectiveStatus('awaiting_review', before, now)).toBe('expired')
    expect(effectiveStatus('awaiting_signature', before, now)).toBe('expired')
    expect(effectiveStatus('draft', before, now)).toBe('expired')
  })

  it('leaves a plan alone before its expiry', () => {
    expect(effectiveStatus('awaiting_review', after, now)).toBe('awaiting_review')
  })

  it('expires exactly at the boundary, not one moment before', () => {
    expect(effectiveStatus('awaiting_review', now, now)).toBe('expired')
    expect(effectiveStatus('awaiting_review', new Date(now.getTime() + 1), now)).toBe('awaiting_review')
  })

  it('never expires a submitted plan — the quote was already spent', () => {
    expect(effectiveStatus('submitted', before, now)).toBe('submitted')
  })

  it('never changes a terminal state', () => {
    for (const s of TERMINAL_STATUSES) expect(effectiveStatus(s, before, now)).toBe(s)
  })
})
