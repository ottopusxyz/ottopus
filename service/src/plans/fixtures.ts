import { randomUUID } from 'node:crypto'
import { type Plan, type PlanDraft, assemblePlan, planDraftSchema } from '../core/index.js'

/**
 * Test-only. A coherent transfer plan for a user, with the knobs tests turn:
 * status, expiry, version. Not exported from the package index.
 */
export const ACCOUNT = 'eip155:8453:0x0000000000000000000000000000000000000001'
export const RECIPIENT = 'eip155:8453:0xd8da6bf26964af9d7eed9e03e53415d37aa96045'

export function inMinutes(n: number, from = new Date()): string {
  return new Date(from.getTime() + n * 60_000).toISOString()
}

export function draftFor(userId: string, overrides: Partial<PlanDraft> = {}): PlanDraft {
  const expiresAt = overrides.expiresAt ?? inMinutes(15)
  return planDraftSchema.parse({
    id: randomUUID(),
    version: 1,
    userId,
    createdVia: 'agent',
    intent: { kind: 'transfer', asset: 'eip155:8453/slip44:60', amount: '1000', to: RECIPIENT },
    provenance: 'route_provider',
    resolution: {
      account: { caip10: ACCOUNT, label: 'Main' },
      candidatesConsidered: [],
      reason: 'only funded account',
    },
    outcome: {
      type: 'calls',
      calls: [{ to: RECIPIENT, value: '1000', data: '0x', chainId: 'eip155:8453' }],
    },
    quote: { provider: 'none', expiresAt },
    humanPlan: { summary: 'Send 1000 wei to vitalik.eth', steps: ['Send'], feesUsd: '0.01', warnings: [] },
    status: 'awaiting_review',
    expiresAt,
    ...overrides,
  })
}

export function planFor(userId: string, overrides: Partial<PlanDraft> = {}): Plan {
  return assemblePlan(draftFor(userId, overrides))
}
