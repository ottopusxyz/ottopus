import { PGlite } from '@electric-sql/pglite'
import { drizzle } from 'drizzle-orm/pglite'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { userIdForDid } from '../auth/session.js'
import { migrationFiles, statementsIn } from '../db/migrate.js'
import * as schema from '../db/schema.js'
import { ACCOUNT, inMinutes, planFor } from './fixtures.js'
import { REVIEW_LINK_TTL_MS, issueReviewLink, supersedePlan } from './review-link.js'
import {
  PlanError,
  createPlan,
  findPlan,
  listPending,
  listPlans,
  listSubmitted,
  summarise,
  mintReviewToken,
  resolveReviewToken,
  revokeReviewTokens,
  transition,
} from './store.js'

/**
 * Against real Postgres, because what matters is what the database enforces:
 * the append-only trigger, the event sequence, the foreign keys. A mock would
 * agree with whatever the store already believes.
 */
let db: ReturnType<typeof drizzle<typeof schema>>
let pg: PGlite
let alice: string
let bob: string

const TX = `0x${'ab'.repeat(32)}`

beforeAll(async () => {
  pg = await PGlite.create()
  await pg.exec(`create role anon; create role authenticated; create role service_role;`)
  for (const file of await migrationFiles(new URL('../../drizzle', import.meta.url).pathname)) {
    for (const stmt of await statementsIn(file)) await pg.exec(stmt)
  }
  db = drizzle(pg, { schema, casing: 'snake_case' })
  alice = await userIdForDid(db, 'did:privy:alice')
  bob = await userIdForDid(db, 'did:privy:bob')
}, 60_000)

beforeEach(async () => {
  // TRUNCATE fires no row triggers, so the append-only guard lets it through.
  await pg.exec(`truncate review_tokens, simulations, plan_events, plans`)
})

describe('createPlan', () => {
  it('writes the row and its first event together', async () => {
    const plan = planFor(alice)
    const record = await createPlan(db, { plan })
    expect(record.plan).toEqual(plan)
    expect(record.plan.status).toBe('awaiting_review')

    const events = await db.select().from(schema.planEvents)
    expect(events).toHaveLength(1)
    expect(events[0]!.status).toBe('awaiting_review')
  })

  it('reads back what it wrote, hash verified', async () => {
    const plan = planFor(alice)
    await createPlan(db, { plan, grantId: null })
    const found = await findPlan(db, alice, plan.id)
    expect(found?.plan).toEqual(plan)
  })

  it('refuses to start a plan in a state it cannot start in', async () => {
    await expect(createPlan(db, { plan: planFor(alice, { status: 'submitted' }) })).rejects.toThrow(PlanError)
    await expect(createPlan(db, { plan: planFor(alice, { status: 'confirmed' }) })).rejects.toThrow(PlanError)
  })

  /** The trigger is the last line of defence for invariant 3; prove it is armed. */
  it('cannot be updated afterwards, whatever the code does', async () => {
    const plan = planFor(alice)
    await createPlan(db, { plan })
    await expect(pg.exec(`update plans set reason = 'edited'`)).rejects.toThrow(/append-only/)
    await expect(pg.exec(`delete from plan_events`)).rejects.toThrow(/append-only/)
  })
})

describe('transition', () => {
  it('walks the happy path, one event each', async () => {
    const plan = planFor(alice)
    await createPlan(db, { plan })
    const step = (to: Parameters<typeof transition>[1]['to'], detail?: Record<string, unknown>) =>
      transition(db, { userId: alice, planId: plan.id, version: 1, to, detail })

    expect(await step('awaiting_signature')).toBe('awaiting_signature')
    expect(await step('submitted', { txHash: TX })).toBe('submitted')
    expect(await step('confirmed')).toBe('confirmed')
    expect((await findPlan(db, alice, plan.id))?.plan.status).toBe('confirmed')
    expect(await db.select().from(schema.planEvents)).toHaveLength(4)
  })

  it('refuses a transition the machine does not allow, and writes nothing', async () => {
    const plan = planFor(alice)
    await createPlan(db, { plan })
    await expect(
      transition(db, { userId: alice, planId: plan.id, version: 1, to: 'submitted' }),
    ).rejects.toMatchObject({ code: 'illegal_transition' })
    expect(await db.select().from(schema.planEvents)).toHaveLength(1)
  })

  it('never leaves a terminal state', async () => {
    const plan = planFor(alice)
    await createPlan(db, { plan })
    await transition(db, { userId: alice, planId: plan.id, version: 1, to: 'cancelled' })
    await expect(
      transition(db, { userId: alice, planId: plan.id, version: 1, to: 'awaiting_signature' }),
    ).rejects.toMatchObject({ code: 'illegal_transition' })
  })

  it('treats a plan past its expiry as expired, even with no expired event', async () => {
    const plan = planFor(alice, { expiresAt: inMinutes(-1) })
    await createPlan(db, { plan })
    expect((await findPlan(db, alice, plan.id))?.plan.status).toBe('expired')
    await expect(
      transition(db, { userId: alice, planId: plan.id, version: 1, to: 'awaiting_signature' }),
    ).rejects.toMatchObject({ code: 'illegal_transition' })
  })

  it('refuses a submission with no transaction hash', async () => {
    const plan = planFor(alice)
    await createPlan(db, { plan })
    await transition(db, { userId: alice, planId: plan.id, version: 1, to: 'awaiting_signature' })
    await expect(
      transition(db, { userId: alice, planId: plan.id, version: 1, to: 'submitted' }),
    ).rejects.toMatchObject({ code: 'missing_tx_hash' })
    await expect(
      transition(db, { userId: alice, planId: plan.id, version: 1, to: 'submitted', detail: { txHash: '0xabc' } }),
    ).rejects.toMatchObject({ code: 'missing_tx_hash' })
    expect((await findPlan(db, alice, plan.id))?.plan.status).toBe('awaiting_signature')
  })

  it('keeps the detail', async () => {
    const plan = planFor(alice)
    await createPlan(db, { plan })
    await transition(db, { userId: alice, planId: plan.id, version: 1, to: 'awaiting_signature' })
    await transition(db, { userId: alice, planId: plan.id, version: 1, to: 'submitted', detail: { txHash: TX } })
    const [last] = await db.select().from(schema.planEvents).orderBy(schema.planEvents.seq).offset(2)
    expect(last!.detail).toEqual({ txHash: TX })
  })

  /** Another person's plan is not found, not forbidden. */
  it('cannot move another user’s plan', async () => {
    const plan = planFor(alice)
    await createPlan(db, { plan })
    await expect(
      transition(db, { userId: bob, planId: plan.id, version: 1, to: 'cancelled' }),
    ).rejects.toMatchObject({ code: 'not_found' })
    expect(await findPlan(db, bob, plan.id)).toBeNull()
    expect((await findPlan(db, alice, plan.id))?.plan.status).toBe('awaiting_review')
  })
})

describe('listPending', () => {
  it('lists plans waiting on the person, newest first', async () => {
    const first = planFor(alice)
    const second = planFor(alice)
    await createPlan(db, { plan: first })
    await new Promise((r) => setTimeout(r, 5))
    await createPlan(db, { plan: second })
    await transition(db, { userId: alice, planId: second.id, version: 1, to: 'awaiting_signature' })

    const pending = await listPending(db, alice)
    expect(pending.map((p) => p.plan.id)).toEqual([second.id, first.id])
    expect(pending.map((p) => p.plan.status)).toEqual(['awaiting_signature', 'awaiting_review'])
  })

  it('leaves out terminal, submitted and expired plans', async () => {
    const cancelled = planFor(alice)
    const submitted = planFor(alice)
    const expired = planFor(alice, { expiresAt: inMinutes(-1) })
    const live = planFor(alice)
    for (const plan of [cancelled, submitted, expired, live]) await createPlan(db, { plan })
    await transition(db, { userId: alice, planId: cancelled.id, version: 1, to: 'cancelled' })
    await transition(db, { userId: alice, planId: submitted.id, version: 1, to: 'awaiting_signature' })
    await transition(db, { userId: alice, planId: submitted.id, version: 1, to: 'submitted', detail: { txHash: TX } })

    expect((await listPending(db, alice)).map((p) => p.plan.id)).toEqual([live.id])
  })

  it('drops a superseded version and keeps the replacement', async () => {
    const v1 = planFor(alice)
    const v2 = planFor(alice, { id: v1.id, version: 2 })
    await createPlan(db, { plan: v1 })
    await createPlan(db, { plan: v2 })
    await transition(db, { userId: alice, planId: v1.id, version: 1, to: 'superseded' })

    const pending = await listPending(db, alice)
    expect(pending.map((p) => [p.plan.id, p.plan.version])).toEqual([[v1.id, 2]])
  })

  it('never lists another user’s plans', async () => {
    await createPlan(db, { plan: planFor(bob) })
    expect(await listPending(db, alice)).toEqual([])
  })
})

describe('review tokens', () => {
  it('resolves a live token to its plan, for its owner', async () => {
    const plan = planFor(alice)
    await createPlan(db, { plan })
    const { token } = await mintReviewToken(db, { planId: plan.id, version: 1, expiresAt: new Date(inMinutes(10)) })

    const resolved = await resolveReviewToken(db, alice, token)
    expect(resolved?.plan).toEqual(plan)
    expect(resolved?.linkExpiresAt).toBeDefined()
  })

  it('stores only the hash', async () => {
    const plan = planFor(alice)
    await createPlan(db, { plan })
    const { token } = await mintReviewToken(db, { planId: plan.id, version: 1, expiresAt: new Date(inMinutes(10)) })
    const [row] = await db.select().from(schema.reviewTokens)
    expect(row!.tokenHash).not.toBe(token)
    expect(row!.tokenHash).not.toContain(token)
  })

  it('is null for a wrong token, an expired one, a revoked one, or someone else', async () => {
    const plan = planFor(alice)
    await createPlan(db, { plan })
    const live = await mintReviewToken(db, { planId: plan.id, version: 1, expiresAt: new Date(inMinutes(10)) })
    const dead = await mintReviewToken(db, { planId: plan.id, version: 1, expiresAt: new Date(inMinutes(-1)) })

    expect(await resolveReviewToken(db, alice, 'not-a-token')).toBeNull()
    expect(await resolveReviewToken(db, alice, dead.token)).toBeNull()
    expect(await resolveReviewToken(db, bob, live.token)).toBeNull()

    expect(await revokeReviewTokens(db, plan.id, 1)).toBe(2)
    expect(await resolveReviewToken(db, alice, live.token)).toBeNull()
  })

  it('binds to one version: superseding kills the old link only', async () => {
    const v1 = planFor(alice)
    const v2 = planFor(alice, { id: v1.id, version: 2 })
    await createPlan(db, { plan: v1 })
    await createPlan(db, { plan: v2 })
    const old = await mintReviewToken(db, { planId: v1.id, version: 1, expiresAt: new Date(inMinutes(10)) })
    const fresh = await mintReviewToken(db, { planId: v1.id, version: 2, expiresAt: new Date(inMinutes(10)) })
    await revokeReviewTokens(db, v1.id, 1)

    expect(await resolveReviewToken(db, alice, old.token)).toBeNull()
    expect((await resolveReviewToken(db, alice, fresh.token))?.plan.version).toBe(2)
  })
})

describe('review link policy', () => {
  it('issues a link no longer than its own clock, and never past the plan', async () => {
    const soon = planFor(alice, { expiresAt: inMinutes(2) })
    const later = planFor(alice, { expiresAt: inMinutes(60) })
    await createPlan(db, { plan: soon })
    await createPlan(db, { plan: later })
    const now = new Date()

    const short = await issueReviewLink(db, { planId: soon.id, version: 1, planExpiresAt: soon.expiresAt }, 'https://ottopus.test', now)
    const long = await issueReviewLink(db, { planId: later.id, version: 1, planExpiresAt: later.expiresAt }, 'https://ottopus.test', now)
    expect(short.expiresAt).toBe(soon.expiresAt)
    expect(new Date(long.expiresAt).getTime()).toBe(now.getTime() + REVIEW_LINK_TTL_MS)
    expect(long.url).toBe(`https://ottopus.test/review/${long.token}`)
  })

  it('superseding writes the event and kills every link to that version', async () => {
    const v1 = planFor(alice)
    await createPlan(db, { plan: v1 })
    await createPlan(db, { plan: planFor(alice, { id: v1.id, version: 2 }) })
    const a = await issueReviewLink(db, { planId: v1.id, version: 1, planExpiresAt: v1.expiresAt }, 'https://ottopus.test')
    const b = await issueReviewLink(db, { planId: v1.id, version: 1, planExpiresAt: v1.expiresAt }, 'https://ottopus.test')

    expect(await supersedePlan(db, { userId: alice, planId: v1.id, version: 1, detail: { trigger: 'quote_expired' } })).toBe('superseded')
    expect(await resolveReviewToken(db, alice, a.token)).toBeNull()
    expect(await resolveReviewToken(db, alice, b.token)).toBeNull()
    expect((await findPlan(db, alice, v1.id, 1))?.plan.status).toBe('superseded')
    expect((await findPlan(db, alice, v1.id))?.plan.version).toBe(2)
  })

  it('cannot supersede another user’s plan, and revokes nothing', async () => {
    const plan = planFor(alice)
    await createPlan(db, { plan })
    const link = await issueReviewLink(db, { planId: plan.id, version: 1, planExpiresAt: plan.expiresAt }, 'https://ottopus.test')
    await expect(supersedePlan(db, { userId: bob, planId: plan.id, version: 1 })).rejects.toMatchObject({ code: 'not_found' })
    expect(await resolveReviewToken(db, alice, link.token)).not.toBeNull()
  })
})

describe('listPlans', () => {
  it('lists every status, waiting-on-you first, then newest first, one row per plan', async () => {
    const done = planFor(alice)
    const waiting = planFor(alice)
    const old = planFor(alice)
    const replaced = planFor(alice)
    for (const plan of [old, done, replaced]) {
      await createPlan(db, { plan })
      await new Promise((r) => setTimeout(r, 5))
    }
    await createPlan(db, { plan: waiting })
    await transition(db, { userId: alice, planId: done.id, version: 1, to: 'cancelled' })
    await createPlan(db, { plan: planFor(alice, { id: replaced.id, version: 2 }) })
    await transition(db, { userId: alice, planId: replaced.id, version: 1, to: 'superseded' })
    await createPlan(db, { plan: planFor(bob) })

    // Version 2 of the replaced plan is the newest row of all; the cancelled
    // one is newer than "old" but sinks below everything still waiting.
    const rows = await listPlans(db, alice)
    expect(rows.map((r) => [r.plan.id, r.plan.version, r.plan.status])).toEqual([
      [replaced.id, 2, 'awaiting_review'],
      [waiting.id, 1, 'awaiting_review'],
      [old.id, 1, 'awaiting_review'],
      [done.id, 1, 'cancelled'],
    ])
    expect(rows.filter((r) => r.plan.id === replaced.id)).toHaveLength(1)
    expect(rows.every((r) => r.plan.userId === alice)).toBe(true)
  })

  it('summarises a row with the words a list needs and none of the calls', async () => {
    const plan = planFor(alice)
    const [row] = (await createPlan(db, { plan }), await listPlans(db, alice))
    const summary = summarise(row!)
    expect(summary).toMatchObject({
      kind: 'transfer',
      chainId: 'eip155:8453',
      asset: { id: 'eip155:8453/slip44:60', amount: '1000', symbol: null, decimals: null },
      recipient: { address: '0xd8da6bf26964af9d7eed9e03e53415d37aa96045', name: null },
      blockedReason: null,
    })
    expect(JSON.stringify(summary)).not.toContain('"calls"')
  })

  it('names what a trade pays and what it buys, so a row is not blank for a swap', async () => {
    const plan = planFor(alice, {
      intent: { kind: 'swap', from: 'eip155:8453/slip44:60', to: 'eip155:8453/erc20:0x4ed4e862860bed51a9570b96d89af5e1b0efefed', amountIn: '2000' },
      humanPlan: {
        summary: 'Swap',
        steps: [],
        feesUsd: 'unknown',
        warnings: [],
        assets: [
          { id: 'eip155:8453/slip44:60', symbol: 'ETH', decimals: 18 },
          { id: 'eip155:8453/erc20:0x4ed4e862860bed51a9570b96d89af5e1b0efefed', symbol: 'DEGEN', decimals: 18 },
        ],
      },
    })
    const [row] = (await createPlan(db, { plan }), await listPlans(db, alice))
    expect(summarise(row!)).toMatchObject({
      kind: 'swap',
      asset: { id: 'eip155:8453/slip44:60', amount: '2000', symbol: 'ETH', decimals: 18 },
      toAsset: { id: 'eip155:8453/erc20:0x4ed4e862860bed51a9570b96d89af5e1b0efefed', symbol: 'DEGEN' },
      recipient: null,
    })
  })

  it('leads a custom plan with its first declared ceiling', async () => {
    const plan = planFor(alice, {
      intent: {
        kind: 'custom',
        fromAccount: ACCOUNT,
        chainId: 'eip155:8453',
        summary: 'Add liquidity',
        expectedChanges: [{ asset: 'eip155:8453/slip44:60', maxOut: '5000' }],
        approvals: [],
      },
    })
    const [row] = (await createPlan(db, { plan }), await listPlans(db, alice))
    expect(summarise(row!)).toMatchObject({ kind: 'custom', asset: { id: 'eip155:8453/slip44:60', amount: '5000' }, toAsset: null })
  })
})

describe('the receipt job’s reads', () => {
  it('lists every user’s plans whose latest event is submitted, and nothing else', async () => {
    const mine = planFor(alice)
    const theirs = planFor(bob)
    const done = planFor(alice)
    const waiting = planFor(alice)
    for (const plan of [mine, theirs, done, waiting]) await createPlan(db, { plan })
    for (const [userId, plan] of [[alice, mine], [bob, theirs], [alice, done]] as const) {
      await transition(db, { userId, planId: plan.id, version: 1, to: 'awaiting_signature' })
      await transition(db, { userId, planId: plan.id, version: 1, to: 'submitted', detail: { txHash: TX } })
    }
    await transition(db, { userId: alice, planId: done.id, version: 1, to: 'confirmed' })

    const submitted = await listSubmitted(db)
    expect(submitted.map((r) => r.plan.id).sort()).toEqual([mine.id, theirs.id].sort())
    for (const record of submitted) {
      expect(record.plan.status).toBe('submitted')
      expect(record.statusDetail).toEqual({ txHash: TX })
    }
  })

  it('carries the transaction hash onto confirmed and failed when the writer omits it', async () => {
    const plan = planFor(alice)
    await createPlan(db, { plan })
    await transition(db, { userId: alice, planId: plan.id, version: 1, to: 'awaiting_signature' })
    await transition(db, { userId: alice, planId: plan.id, version: 1, to: 'submitted', detail: { txHash: TX } })
    await transition(db, { userId: alice, planId: plan.id, version: 1, to: 'confirmed' })
    const record = await findPlan(db, alice, plan.id)
    expect(record?.plan.status).toBe('confirmed')
    expect(record?.statusDetail).toEqual({ txHash: TX })

    const other = planFor(alice)
    await createPlan(db, { plan: other })
    await transition(db, { userId: alice, planId: other.id, version: 1, to: 'awaiting_signature' })
    await transition(db, { userId: alice, planId: other.id, version: 1, to: 'submitted', detail: { txHash: TX } })
    await transition(db, { userId: alice, planId: other.id, version: 1, to: 'failed', detail: { reason: 'reverted' } })
    expect((await findPlan(db, alice, other.id))?.statusDetail).toEqual({ reason: 'reverted', txHash: TX })
  })
})
