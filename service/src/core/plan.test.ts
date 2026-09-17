import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { PLAN_STATUSES, callSchema, isTerminal, planDraftSchema, planStatusSchema } from './plan.js'

describe('status vocabulary', () => {
  /**
   * The vocabulary lives in three places: this file, the database check
   * constraint, and the canonical plan doc. Drift between them breaks MCP
   * responses, activity filters and the review UI at once, so it is checked
   * rather than trusted.
   */
  it('matches the database check constraint exactly', async () => {
    const sql = await readFile(new URL('../../drizzle/0000_base_schema.sql', import.meta.url), 'utf8')
    const clause = /plan_events_status[^(]*\(([^)]*)\)/s.exec(sql)
    expect(clause, 'plan_events_status constraint not found in the migration').toBeTruthy()
    const inDb = [...clause![1]!.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]!).sort()
    expect(inDb).toEqual([...PLAN_STATUSES].sort())
  })

  it('has no "simulated" state — simulation is evidence, not a state', () => {
    expect(PLAN_STATUSES).not.toContain('simulated')
  })

  it('has no "inked" state — that is mascot copy for cancelled', () => {
    expect(PLAN_STATUSES).not.toContain('inked')
    expect(PLAN_STATUSES).toContain('cancelled')
  })

  it('rejects a status outside the vocabulary', () => {
    expect(() => planStatusSchema.parse('simulated')).toThrow()
    expect(() => planStatusSchema.parse('reviewed')).toThrow()
  })
})

describe('terminal states', () => {
  it('treats every ending as terminal', () => {
    for (const s of ['confirmed', 'failed', 'expired', 'blocked', 'superseded', 'cancelled'] as const) {
      expect(isTerminal(s)).toBe(true)
    }
  })

  it('treats states a plan can still leave as non-terminal', () => {
    for (const s of ['draft', 'awaiting_review', 'awaiting_signature', 'submitted'] as const) {
      expect(isTerminal(s)).toBe(false)
    }
  })
})

describe('calls', () => {
  it('lowercases calldata, so comparison cannot depend on casing', () => {
    const call = callSchema.parse({
      to: 'eip155:8453:0xABCDEF0123456789abcdef0123456789ABCDEF01',
      value: '0',
      data: '0xA9059CBB',
      chainId: 'eip155:8453',
    })
    expect(call.data).toBe('0xa9059cbb')
    expect(call.to).toBe('eip155:8453:0xabcdef0123456789abcdef0123456789abcdef01')
  })

  it('rejects a value that is not an integer string', () => {
    const bad = { to: 'eip155:1:0xd8da6bf26964af9d7eed9e03e53415d37aa96045', value: '1.5', data: '0x', chainId: 'eip155:1' }
    expect(() => callSchema.parse(bad)).toThrow()
  })

  it('rejects a target and chainId that name different chains', () => {
    // Otherwise the transaction goes to whatever lives at that address on the
    // wrong network.
    expect(() =>
      callSchema.parse({
        to: 'eip155:8453:0xd8da6bf26964af9d7eed9e03e53415d37aa96045',
        value: '0',
        data: '0x',
        chainId: 'eip155:1',
      }),
    ).toThrow(/same chain/)
  })

  it('rejects an unknown key rather than silently dropping it', () => {
    expect(() =>
      callSchema.parse({
        to: 'eip155:1:0xd8da6bf26964af9d7eed9e03e53415d37aa96045',
        value: '0',
        data: '0x',
        chainId: 'eip155:1',
        gasLimit: '21000',
      }),
    ).toThrow()
  })
})

describe('plan draft is strict about security fields', () => {
  const draft = {
    id: '018f0b6c-4a3b-4b2e-9c1d-2f5a6b7c8d9e',
    version: 1,
    userId: '0191a2b3-c4d5-4e6f-8a9b-0c1d2e3f4a5b',
    createdVia: 'agent' as const,
    intent: {
      kind: 'transfer' as const,
      asset: 'eip155:8453/slip44:60',
      amount: '1',
      to: 'eip155:8453:0xd8da6bf26964af9d7eed9e03e53415d37aa96045',
    },
    provenance: 'route_provider' as const,
    resolution: {
      account: { caip10: 'eip155:8453:0x0000000000000000000000000000000000000001' },
      candidatesConsidered: [],
      reason: 'only funded account',
    },
    outcome: {
      type: 'calls' as const,
      calls: [{ to: 'eip155:8453:0xd8da6bf26964af9d7eed9e03e53415d37aa96045', value: '1', data: '0x', chainId: 'eip155:8453' }],
    },
    quote: { provider: 'test', expiresAt: '2026-09-05T12:00:00Z' },
    humanPlan: { summary: 's', steps: [], feesUsd: '0.01', warnings: [] },
    status: 'awaiting_review' as const,
    expiresAt: '2026-09-05T12:00:00Z',
  }

  it('accepts a coherent draft', () => {
    expect(planDraftSchema.parse(draft).version).toBe(1)
  })

  it('refuses a plan carrying planHash rather than quietly stripping it', () => {
    // Zod strips unknown keys by default, so a non-strict schema here would
    // silently delete planHash, decodedActions and simulation.
    expect(() => planDraftSchema.parse({ ...draft, planHash: '0xdeadbeef' })).toThrow()
  })

  it('rejects a call on a chain the resolved account is not on', () => {
    expect(() =>
      planDraftSchema.parse({
        ...draft,
        outcome: {
          type: 'calls' as const,
          calls: [{ to: 'eip155:1:0xd8da6bf26964af9d7eed9e03e53415d37aa96045', value: '1', data: '0x', chainId: 'eip155:1' }],
        },
      }),
    ).toThrow(/same chain as the resolved account/)
  })
})

describe('the plan is bound to its intent', () => {
  const base = {
    id: '018f0b6c-4a3b-4b2e-9c1d-2f5a6b7c8d9e',
    version: 1,
    userId: '0191a2b3-c4d5-4e6f-8a9b-0c1d2e3f4a5b',
    createdVia: 'agent' as const,
    provenance: 'route_provider' as const,
    quote: { provider: 'test', expiresAt: '2026-09-05T12:00:00Z' },
    humanPlan: { summary: 's', steps: [], feesUsd: '0.01', warnings: [] },
    status: 'awaiting_review' as const,
    expiresAt: '2026-09-05T12:00:00Z',
  }

  const baseIntent = {
    kind: 'transfer' as const,
    asset: 'eip155:8453/slip44:60',
    amount: '1',
    to: 'eip155:8453:0xd8da6bf26964af9d7eed9e03e53415d37aa96045',
  }

  it('rejects a Base intent resolved against an Ethereum account', () => {
    // Resolution and calls agree with each other, and still execute something
    // the user never asked for.
    expect(() =>
      planDraftSchema.parse({
        ...base,
        intent: baseIntent,
        resolution: {
          account: { caip10: 'eip155:1:0x0000000000000000000000000000000000000001' },
          candidatesConsidered: [],
          reason: 'r',
        },
        outcome: {
          type: 'calls' as const,
          calls: [{ to: 'eip155:1:0xd8da6bf26964af9d7eed9e03e53415d37aa96045', value: '1', data: '0x', chainId: 'eip155:1' }],
        },
      }),
    ).toThrow(/chain the intent executes on/)
  })

  it('accepts a plan whose intent, account and calls all agree', () => {
    const ok = planDraftSchema.parse({
      ...base,
      intent: baseIntent,
      resolution: {
        account: { caip10: 'eip155:8453:0x0000000000000000000000000000000000000001' },
        candidatesConsidered: [],
        reason: 'r',
      },
      outcome: {
        type: 'calls' as const,
        calls: [{ to: 'eip155:8453:0xd8da6bf26964af9d7eed9e03e53415d37aa96045', value: '1', data: '0x', chainId: 'eip155:8453' }],
      },
    })
    expect(ok.status).toBe('awaiting_review')
  })

  it('binds a bridge to its source chain, where signing happens', () => {
    const ok = planDraftSchema.parse({
      ...base,
      intent: {
        kind: 'bridge' as const,
        asset: 'eip155:8453/erc20:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
        amount: '1',
        toChain: 'eip155:56',
      },
      resolution: {
        account: { caip10: 'eip155:8453:0x0000000000000000000000000000000000000001' },
        candidatesConsidered: [],
        reason: 'r',
      },
      outcome: {
        type: 'calls' as const,
        calls: [{ to: 'eip155:8453:0xd8da6bf26964af9d7eed9e03e53415d37aa96045', value: '0', data: '0x', chainId: 'eip155:8453' }],
      },
    })
    expect(ok.intent.kind).toBe('bridge')
  })
})
