import { describe, expect, it } from 'vitest'
import { PlanIntegrityError, assemblePlan, canonicalize, parsePlan, planHashOf } from './hash.js'
import { type PlanDraft, planDraftSchema } from './plan.js'

const draft: PlanDraft = planDraftSchema.parse({
  id: '018f0b6c-4a3b-4b2e-9c1d-2f5a6b7c8d9e',
  version: 1,
  userId: '0191a2b3-c4d5-4e6f-8a9b-0c1d2e3f4a5b',
  createdVia: 'agent',
  intent: {
    kind: 'transfer',
    asset: 'eip155:8453/slip44:60',
    amount: '1000',
    to: 'eip155:8453:0xd8da6bf26964af9d7eed9e03e53415d37aa96045',
  },
  provenance: 'route_provider',
  resolution: {
    account: { caip10: 'eip155:8453:0x0000000000000000000000000000000000000001', label: 'Main' },
    candidatesConsidered: [],
    reason: 'only funded account',
  },
  outcome: {
    type: 'calls',
    calls: [
      {
        to: 'eip155:8453:0xd8da6bf26964af9d7eed9e03e53415d37aa96045',
        value: '1000',
        data: '0x',
        chainId: 'eip155:8453',
      },
    ],
  },
  quote: { provider: 'none', expiresAt: '2026-09-09T12:15:00Z' },
  humanPlan: { summary: 'Send 1000 wei', steps: ['Send'], feesUsd: '0.01', warnings: [] },
  status: 'awaiting_review',
  expiresAt: '2026-09-09T12:15:00Z',
})

describe('canonical form', () => {
  it('is independent of key order at every level', () => {
    const a = canonicalize({ b: 1, a: { d: [1, { z: 1, y: 2 }], c: 'x' } })
    const b = canonicalize({ a: { c: 'x', d: [1, { y: 2, z: 1 }] }, b: 1 })
    expect(a).toBe(b)
    expect(a).toBe('{"a":{"c":"x","d":[1,{"y":2,"z":1}]},"b":1}')
  })

  it('drops undefined but keeps null', () => {
    expect(canonicalize({ a: undefined, b: null })).toBe('{"b":null}')
  })

  it('keeps array order — a reordered call list is a different plan', () => {
    expect(canonicalize([1, 2])).not.toBe(canonicalize([2, 1]))
  })

  it('refuses a float, because "0.1" and 0.1 must not be two plans', () => {
    expect(() => canonicalize({ amount: 0.1 })).toThrow(PlanIntegrityError)
    expect(() => canonicalize(Number.NaN)).toThrow(PlanIntegrityError)
  })
})

describe('planHash', () => {
  it('is deterministic', () => {
    expect(planHashOf(draft)).toBe(planHashOf(structuredClone(draft)))
    expect(planHashOf(draft)).toMatch(/^[0-9a-f]{64}$/)
  })

  it('ignores status, which lives in events', () => {
    expect(planHashOf({ ...draft, status: 'confirmed' })).toBe(planHashOf(draft))
  })

  it.each([
    ['version', { version: 2 }],
    ['userId', { userId: '0191a2b3-c4d5-4e6f-8a9b-0c1d2e3f4a5c' }],
    ['account', { resolution: { ...draft.resolution, account: { caip10: 'eip155:8453:0x0000000000000000000000000000000000000002' } } }],
    ['amount', { intent: { ...draft.intent, amount: '1001' } }],
    ['recipient', { intent: { ...draft.intent, to: 'eip155:8453:0x0000000000000000000000000000000000000009' } }],
    ['calldata', { outcome: { type: 'calls', calls: [{ ...draft.outcome.type === 'calls' ? draft.outcome.calls[0]! : {}, data: '0x01' }] } }],
    ['quote expiry', { quote: { ...draft.quote, expiresAt: '2026-09-09T12:16:00Z' } }],
    ['plan expiry', { expiresAt: '2026-09-09T12:16:00Z' }],
    ['summary', { humanPlan: { ...draft.humanPlan, summary: 'Send 1 wei' } }],
    ['provenance', { provenance: 'agent_crafted' }],
  ] as const)('changes when %s changes', (_, patch) => {
    expect(planHashOf({ ...draft, ...patch } as PlanDraft)).not.toBe(planHashOf(draft))
  })
})

describe('assemble and parse', () => {
  it('stamps the hash and empty evidence', () => {
    const plan = assemblePlan(draft)
    expect(plan.planHash).toBe(planHashOf(draft))
    expect(plan.decodedActions).toEqual([])
    expect(plan.simulation).toBeNull()
  })

  /**
   * Parsing normalises calldata to lowercase. A hash taken before that would
   * bind the plan to bytes that are never stored, and the plan would fail its
   * own integrity check on the way back out.
   */
  it('hashes the normalised draft, so a raw draft still round-trips', () => {
    const raw = {
      ...draft,
      outcome: { type: 'calls' as const, calls: [{ ...draft.outcome.type === 'calls' ? draft.outcome.calls[0]! : {}, data: '0xABCD' }] },
    } as PlanDraft
    const plan = assemblePlan(raw)
    expect(plan.outcome.type === 'calls' && plan.outcome.calls[0]!.data).toBe('0xabcd')
    expect(() => parsePlan(plan)).not.toThrow()
    expect(plan.planHash).toBe(planHashOf(planDraftSchema.parse(raw)))
  })

  it('round-trips through parsePlan', () => {
    const plan = assemblePlan(draft)
    expect(parsePlan(JSON.parse(JSON.stringify(plan)))).toEqual(plan)
  })

  it('rejects a plan whose contents no longer match its hash', () => {
    const plan = assemblePlan(draft)
    const tampered = { ...plan, humanPlan: { ...plan.humanPlan, summary: 'Send nothing' } }
    expect(() => parsePlan(tampered)).toThrow(PlanIntegrityError)
  })

  it('rejects a plan whose hash was edited to something well-formed', () => {
    const plan = assemblePlan(draft)
    expect(() => parsePlan({ ...plan, planHash: 'a'.repeat(64) })).toThrow(PlanIntegrityError)
  })

  it('does not let evidence change the hash', () => {
    const bare = assemblePlan(draft)
    const withEvidence = assemblePlan(draft, {
      decodedActions: [
        {
          target: 'eip155:8453:0xd8da6bf26964af9d7eed9e03e53415d37aa96045',
          source: 'abi',
          verified: true,
          function: 'transfer(address,uint256)',
          args: [],
          value: '1000',
        },
      ],
    })
    expect(withEvidence.planHash).toBe(bare.planHash)
    expect(() => parsePlan(withEvidence)).not.toThrow()
  })

  it('still enforces the draft bindings on a complete plan', () => {
    const plan = assemblePlan(draft)
    const crossChain = {
      ...plan,
      resolution: { ...plan.resolution, account: { caip10: 'eip155:1:0x0000000000000000000000000000000000000001' } },
    }
    expect(() => parsePlan(crossChain)).toThrow(/chain/)
  })
})
