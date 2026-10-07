import { PGlite } from '@electric-sql/pglite'
import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/pglite'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { userIdForDid } from '../auth/session.js'
import { migrationFiles, statementsIn } from '../db/migrate.js'
import * as schema from '../db/schema.js'
import type { SentTransaction } from '../verify/index.js'
import { ACCOUNT, RECIPIENT, inMinutes, planFor } from './fixtures.js'
import { handOff, recordExecution } from './handoff.js'
import { supersedePlan } from './review-link.js'
import { createPlan, findPlan, listSubmitted, transition } from './store.js'

/**
 * The one place the invariants bend, so the tests are about where they do
 * not: the calls of a plan leave for an approved plan on an agent-operated
 * arm, and for nothing else. Against real Postgres, like the store's own.
 */
let db: ReturnType<typeof drizzle<typeof schema>>
let pg: PGlite
let alice: string
let bob: string
let agentArm: string
let browserArm: string

const ARM_ADDRESS = ACCOUNT.split(':')[2]!
const OTHER_ADDRESS = '0x00000000000000000000000000000000000000ff'
const TX = `0x${'ab'.repeat(32)}`
const OTHER_TX = `0x${'cd'.repeat(32)}`

/** The fixture plan's one call, as the chain reports it once `from` has sent it. */
const sentBy = (from: string, over: Partial<SentTransaction> = {}): SentTransaction => ({
  from,
  to: RECIPIENT.split(':')[2]!,
  value: '1000',
  input: '0x',
  ...over,
})

const arm = async (userId: string, over: Partial<typeof schema.linkedWallets.$inferInsert> = {}) => {
  const [row] = await db
    .insert(schema.linkedWallets)
    .values({
      userId,
      address: ARM_ADDRESS,
      walletType: 'agentic',
      agentProvider: 'binance',
      ownershipProof: { signature: '0x01' },
      provedAt: new Date(),
      ...over,
    })
    .returning({ id: schema.linkedWallets.id })
  return row!.id
}

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
  await pg.exec(`truncate review_tokens, simulations, plan_events, plans, linked_wallets cascade`)
  agentArm = await arm(alice)
  browserArm = await arm(alice, { address: OTHER_ADDRESS, walletType: 'metamask', agentProvider: null })
})

const ref = (planId: string, userId = alice) => ({ userId, planId, version: 1 })
const events = () => db.select().from(schema.planEvents).orderBy(schema.planEvents.seq)

/** A plan on the agent's arm, taken as far as `approved`. */
async function approvedPlan(over: Parameters<typeof planFor>[1] = {}, walletId = agentArm) {
  const plan = planFor(alice, over)
  await createPlan(db, { plan, walletId })
  await transition(db, { ...ref(plan.id), to: 'approved' })
  return plan
}

describe('approving', () => {
  it('is allowed for a plan on an agent-operated arm', async () => {
    const plan = planFor(alice)
    await createPlan(db, { plan, walletId: agentArm })
    expect(await transition(db, { ...ref(plan.id), to: 'approved' })).toBe('approved')
    expect((await findPlan(db, alice, plan.id))?.plan.status).toBe('approved')
  })

  it('is refused for a wallet a person signs with, and for a plan bound to no wallet', async () => {
    for (const walletId of [browserArm, null]) {
      const plan = planFor(alice)
      await createPlan(db, { plan, walletId })
      await expect(transition(db, { ...ref(plan.id), to: 'approved' })).rejects.toMatchObject({ code: 'not_agentic' })
      expect((await findPlan(db, alice, plan.id))?.plan.status).toBe('awaiting_review')
    }
  })

  it('is refused once the agent arm is unlinked, unproved, or its provider is unknown', async () => {
    const cases: Partial<typeof schema.linkedWallets.$inferInsert>[] = [
      { unlinkedAt: new Date() },
      { provedAt: null },
      { agentProvider: 'gone' },
    ]
    for (const [i, over] of cases.entries()) {
      const walletId = await arm(alice, { address: `0x${String(i + 1).padStart(40, 'a')}`, ...over })
      const plan = planFor(alice)
      await createPlan(db, { plan, walletId })
      await expect(transition(db, { ...ref(plan.id), to: 'approved' })).rejects.toMatchObject({ code: 'not_agentic' })
    }
  })

  it('is refused for an arm that belongs to someone else', async () => {
    const bobsArm = await arm(bob, { address: OTHER_ADDRESS })
    const plan = planFor(alice)
    await createPlan(db, { plan, walletId: bobsArm })
    await expect(transition(db, { ...ref(plan.id), to: 'approved' })).rejects.toMatchObject({ code: 'not_agentic' })
  })

  /** The mark is the store's own. A caller's word for it would lock cancel and open the report with nothing released. */
  it('does not take the hand-off mark from whoever approves', async () => {
    const plan = planFor(alice)
    await createPlan(db, { plan, walletId: agentArm })
    await transition(db, { ...ref(plan.id), to: 'approved', detail: { handedOffAt: '2026-01-01T00:00:00.000Z', via: 'review' } })
    expect((await findPlan(db, alice, plan.id))?.statusDetail).toEqual({ via: 'review' })

    await expect(recordExecution(db, { ...ref(plan.id), txHash: TX, sent: sentBy(ARM_ADDRESS) })).rejects.toMatchObject({
      code: 'illegal_transition',
    })
    expect((await handOff(db, ref(plan.id)))?.first).toBe(true)

    const withdrawn = planFor(alice)
    await createPlan(db, { plan: withdrawn, walletId: agentArm })
    await transition(db, { ...ref(withdrawn.id), to: 'approved', detail: { handedOffAt: '2026-01-01T00:00:00.000Z' } })
    expect(await transition(db, { ...ref(withdrawn.id), to: 'cancelled' })).toBe('cancelled')
  })

  it('only from review: a plan cannot start approved', async () => {
    await expect(createPlan(db, { plan: planFor(alice, { status: 'approved' }), walletId: agentArm })).rejects.toMatchObject({
      code: 'illegal_initial_status',
    })
  })
})

describe('approving by the arm’s rule', () => {
  const switchOn = (walletId: string) =>
    db.update(schema.linkedWallets).set({ autoExecute: true }).where(eq(schema.linkedWallets.id, walletId))

  it('writes review and approval together, marked as the rule’s, and the calls are released', async () => {
    await switchOn(agentArm)
    const plan = planFor(alice)
    const record = await createPlan(db, { plan, walletId: agentArm, approveByRule: true })
    expect(record.plan.status).toBe('approved')
    expect(record.statusDetail).toEqual({ approvedBy: 'rule' })
    expect((await events()).map((e) => [e.status, e.detail])).toEqual([
      ['awaiting_review', null],
      ['approved', { approvedBy: 'rule' }],
    ])
    expect(await handOff(db, ref(plan.id))).toMatchObject({ planHash: plan.planHash, address: ARM_ADDRESS, first: true })
  })

  it('leaves the plan waiting for review when the switch is off, whatever the caller found', async () => {
    const plan = planFor(alice)
    const record = await createPlan(db, { plan, walletId: agentArm, approveByRule: true })
    expect(record.plan.status).toBe('awaiting_review')
    expect((await events()).map((e) => e.status)).toEqual(['awaiting_review'])
  })

  it('never approves a plan on a browser-signed arm, or one bound to no arm', async () => {
    for (const walletId of [browserArm, null]) {
      const plan = planFor(alice)
      const record = await createPlan(db, { plan, walletId, approveByRule: true })
      expect(record.plan.status).toBe('awaiting_review')
      expect(await handOff(db, ref(plan.id))).toBeNull()
    }
  })

  it('never approves a plan already past its expiry', async () => {
    await switchOn(agentArm)
    const plan = planFor(alice, { expiresAt: inMinutes(-1) })
    const record = await createPlan(db, { plan, walletId: agentArm, approveByRule: true })
    expect(record.plan.status).toBe('expired')
    expect((await events()).map((e) => e.status)).toEqual(['awaiting_review'])
    expect(await handOff(db, ref(plan.id))).toBeNull()
  })

  it('never approves a blocked plan', async () => {
    await switchOn(agentArm)
    const record = await createPlan(db, { plan: planFor(alice, { status: 'blocked' }), walletId: agentArm, approveByRule: true })
    expect(record.plan.status).toBe('blocked')
    expect((await events()).map((e) => e.status)).toEqual(['blocked'])
  })

  it('switching the rule off afterwards leaves an approved plan approved', async () => {
    await switchOn(agentArm)
    const plan = planFor(alice)
    await createPlan(db, { plan, walletId: agentArm, approveByRule: true })
    await db.update(schema.linkedWallets).set({ autoExecute: false }).where(eq(schema.linkedWallets.id, agentArm))
    expect((await findPlan(db, alice, plan.id))?.plan.status).toBe('approved')
    expect(await handOff(db, ref(plan.id))).toMatchObject({ first: true })
  })
})

describe('handing the calls to the agent', () => {
  it('releases the calls, the hash and the provider of an approved plan', async () => {
    const plan = await approvedPlan()
    const handoff = await handOff(db, ref(plan.id))
    expect(handoff).toMatchObject({
      planHash: plan.planHash,
      address: ARM_ADDRESS,
      first: true,
      profile: { id: 'binance' },
    })
    expect(handoff!.calls).toEqual(plan.outcome.type === 'calls' ? plan.outcome.calls : [])
  })

  it('never outside approved', async () => {
    const plan = planFor(alice)
    await createPlan(db, { plan, walletId: agentArm })
    expect(await handOff(db, ref(plan.id)), 'awaiting_review').toBeNull()

    await transition(db, { ...ref(plan.id), to: 'awaiting_signature' })
    expect(await handOff(db, ref(plan.id)), 'awaiting_signature').toBeNull()

    await transition(db, { ...ref(plan.id), to: 'cancelled' })
    expect(await handOff(db, ref(plan.id)), 'cancelled').toBeNull()

    const blocked = planFor(alice, { status: 'blocked' })
    await createPlan(db, { plan: blocked, walletId: agentArm })
    expect(await handOff(db, ref(blocked.id)), 'blocked').toBeNull()

    // Nothing was written by any of the refusals.
    expect((await events()).map((e) => e.status)).toEqual(['awaiting_review', 'awaiting_signature', 'cancelled', 'blocked'])
  })

  /**
   * The store already refuses to approve such a plan. This is the second
   * lock: an `approved` event that got there some other way still releases
   * nothing to a wallet a person signs with.
   */
  it('never for a browser-signed arm, even with an approved event on record', async () => {
    for (const walletId of [browserArm, null]) {
      const plan = planFor(alice)
      await createPlan(db, { plan, walletId })
      await db.insert(schema.planEvents).values({ planId: plan.id, planVersion: 1, status: 'approved' })
      expect((await findPlan(db, alice, plan.id))?.plan.status).toBe('approved')
      expect(await handOff(db, ref(plan.id))).toBeNull()
    }
  })

  it('never after expiry', async () => {
    const plan = await approvedPlan({ expiresAt: inMinutes(5) })
    const late = new Date(Date.now() + 6 * 60_000)
    expect(await handOff(db, ref(plan.id), late)).toBeNull()
    expect((await events()).map((e) => e.status)).toEqual(['awaiting_review', 'approved'])
  })

  it('never after expiry, even for calls already handed out once', async () => {
    const plan = await approvedPlan({ expiresAt: inMinutes(5) })
    expect((await handOff(db, ref(plan.id)))?.first).toBe(true)
    expect(await handOff(db, ref(plan.id), new Date(Date.now() + 6 * 60_000))).toBeNull()
  })

  it('never to another user, and never when the arm is not the account the plan was built for', async () => {
    const plan = await approvedPlan()
    expect(await handOff(db, ref(plan.id, bob))).toBeNull()

    // Bound to an agent arm whose address is not the plan's account.
    const elsewhere = await arm(alice, { address: `0x${'c'.repeat(40)}` })
    const mismatched = await approvedPlan({}, elsewhere)
    expect(await handOff(db, ref(mismatched.id))).toBeNull()
  })

  it('never once the arm is unlinked', async () => {
    const plan = await approvedPlan()
    await pg.exec(`update linked_wallets set unlinked_at = now() where id = '${agentArm}'`)
    expect(await handOff(db, ref(plan.id))).toBeNull()
  })

  it('is released once: the first read writes an event, a later read repeats it and writes nothing', async () => {
    const plan = await approvedPlan()
    const first = await handOff(db, ref(plan.id))
    expect(first?.first).toBe(true)
    expect(await events()).toHaveLength(3)

    const again = await handOff(db, ref(plan.id))
    expect(again).toMatchObject({ first: false, handedOffAt: first!.handedOffAt, planHash: plan.planHash })
    expect(again!.calls).toEqual(first!.calls)
    expect(await events()).toHaveLength(3)

    const record = await findPlan(db, alice, plan.id)
    expect(record?.plan.status).toBe('approved')
    expect(record?.statusDetail).toMatchObject({ handedOffAt: first!.handedOffAt })
  })

  it('stops repeating once the plan is no longer approved', async () => {
    const plan = await approvedPlan()
    await handOff(db, ref(plan.id))
    await recordExecution(db, { ...ref(plan.id), txHash: TX, sent: sentBy(ARM_ADDRESS) })
    expect(await handOff(db, ref(plan.id))).toBeNull()
  })
})

describe('withdrawing an approved plan', () => {
  it('is allowed while the calls have not left', async () => {
    const plan = await approvedPlan()
    expect(await transition(db, { ...ref(plan.id), to: 'cancelled' })).toBe('cancelled')
    expect(await handOff(db, ref(plan.id))).toBeNull()
  })

  it('is refused once they have: nothing here can promise they were not sent', async () => {
    const plan = await approvedPlan()
    await handOff(db, ref(plan.id))
    await expect(transition(db, { ...ref(plan.id), to: 'cancelled' })).rejects.toMatchObject({ code: 'illegal_transition' })
    await expect(supersedePlan(db, { ...ref(plan.id) })).rejects.toMatchObject({ code: 'illegal_transition' })
    expect((await findPlan(db, alice, plan.id))?.plan.status).toBe('approved')
  })
})

describe('reporting an execution', () => {
  it('moves the plan to submitted with the hash, where the receipts job finds it', async () => {
    const plan = await approvedPlan()
    const { handedOffAt } = (await handOff(db, ref(plan.id)))!
    expect(await recordExecution(db, { ...ref(plan.id), txHash: TX, sent: sentBy(ARM_ADDRESS.toUpperCase().replace('0X', '0x')) })).toBe(
      'submitted',
    )

    const record = await findPlan(db, alice, plan.id)
    expect(record?.plan.status).toBe('submitted')
    expect(record?.statusDetail).toEqual({ txHash: TX, handedOffAt, reportedBy: 'agent' })
    expect((await listSubmitted(db)).map((r) => r.plan.id)).toEqual([plan.id])

    // And from there it ends like any submitted plan, the hash carried along.
    await transition(db, { ...ref(plan.id), to: 'confirmed' })
    expect((await findPlan(db, alice, plan.id))?.statusDetail).toMatchObject({ txHash: TX })
  })

  it('refuses a transaction the arm did not send', async () => {
    const plan = await approvedPlan()
    await handOff(db, ref(plan.id))
    await expect(recordExecution(db, { ...ref(plan.id), txHash: TX, sent: sentBy(OTHER_ADDRESS) })).rejects.toMatchObject({
      code: 'wrong_sender',
    })
    expect((await findPlan(db, alice, plan.id))?.plan.status).toBe('approved')
  })

  /** The arm's own transaction, but an older or unrelated one: sent by the right wallet is not sent for this plan. */
  it('refuses a transaction of the arm that is not the plan’s call', async () => {
    const plan = await approvedPlan()
    await handOff(db, ref(plan.id))
    const others: Partial<SentTransaction>[] = [
      { to: OTHER_ADDRESS },
      { to: null },
      { value: '999' },
      { input: '0xa9059cbb' },
    ]
    for (const over of others) {
      await expect(recordExecution(db, { ...ref(plan.id), txHash: TX, sent: sentBy(ARM_ADDRESS, over) })).rejects.toMatchObject({
        code: 'wrong_call',
      })
    }
    expect((await findPlan(db, alice, plan.id))?.plan.status).toBe('approved')
  })

  it('holds a plan with several calls to its last one, whatever case the chain spells it in', async () => {
    const token = 'eip155:8453:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913'
    const data = '0xa9059cbb000000000000000000000000d8da6bf26964af9d7eed9e03e53415d37aa96045'
    const plan = await approvedPlan({
      outcome: {
        type: 'calls',
        calls: [
          { to: RECIPIENT, value: '1000', data: '0x', chainId: 'eip155:8453' },
          { to: token, value: '0', data, chainId: 'eip155:8453' },
        ],
      },
    })
    await handOff(db, ref(plan.id))
    await expect(recordExecution(db, { ...ref(plan.id), txHash: TX, sent: sentBy(ARM_ADDRESS) })).rejects.toMatchObject({
      code: 'wrong_call',
    })
    const last = sentBy(ARM_ADDRESS, { to: token.split(':')[2]!.toUpperCase().replace('0X', '0x'), value: '0', input: data.toUpperCase().replace('0X', '0x') })
    expect(await recordExecution(db, { ...ref(plan.id), txHash: TX, sent: last })).toBe('submitted')
  })

  /** Two plans with the same call, a repeat payment, and one transaction: it settles one of them. */
  it('refuses a transaction another plan was already settled with', async () => {
    const first = await approvedPlan()
    const second = await approvedPlan()
    await handOff(db, ref(first.id))
    await handOff(db, ref(second.id))
    await recordExecution(db, { ...ref(first.id), txHash: TX, sent: sentBy(ARM_ADDRESS) })

    const again = TX.toUpperCase().replace('0X', '0x')
    await expect(recordExecution(db, { ...ref(second.id), txHash: again, sent: sentBy(ARM_ADDRESS) })).rejects.toMatchObject({
      code: 'hash_taken',
    })
    // Still so once the first has settled, and the second takes its own transaction.
    await transition(db, { ...ref(first.id), to: 'confirmed' })
    await expect(recordExecution(db, { ...ref(second.id), txHash: TX, sent: sentBy(ARM_ADDRESS) })).rejects.toMatchObject({
      code: 'hash_taken',
    })
    expect(await recordExecution(db, { ...ref(second.id), txHash: OTHER_TX, sent: sentBy(ARM_ADDRESS) })).toBe('submitted')
  })

  it('refuses a plan whose calls were never handed out', async () => {
    const plan = await approvedPlan()
    await expect(recordExecution(db, { ...ref(plan.id), txHash: TX, sent: sentBy(ARM_ADDRESS) })).rejects.toMatchObject({
      code: 'illegal_transition',
    })
  })

  it('refuses anything that is not approved, and a second report', async () => {
    const waiting = planFor(alice)
    await createPlan(db, { plan: waiting, walletId: agentArm })
    await expect(recordExecution(db, { ...ref(waiting.id), txHash: TX, sent: sentBy(ARM_ADDRESS) })).rejects.toMatchObject({
      code: 'illegal_transition',
    })

    const plan = await approvedPlan()
    await handOff(db, ref(plan.id))
    await recordExecution(db, { ...ref(plan.id), txHash: TX, sent: sentBy(ARM_ADDRESS) })
    // Reported once; a second report has nothing to move.
    await expect(recordExecution(db, { ...ref(plan.id), txHash: TX, sent: sentBy(ARM_ADDRESS) })).rejects.toMatchObject({
      code: 'illegal_transition',
    })
  })

  it('refuses an approved plan past its expiry, handed out or not', async () => {
    const plan = await approvedPlan({ expiresAt: inMinutes(5) })
    await handOff(db, ref(plan.id))
    const late = new Date(Date.now() + 6 * 60_000)
    await expect(recordExecution(db, { ...ref(plan.id), txHash: TX, sent: sentBy(ARM_ADDRESS) }, late)).rejects.toMatchObject({
      code: 'illegal_transition',
    })
    expect((await events()).map((e) => e.status)).toEqual(['awaiting_review', 'approved', 'approved'])
  })

  it('refuses a malformed hash, another user, and a plan that does not exist', async () => {
    const plan = await approvedPlan()
    await handOff(db, ref(plan.id))
    await expect(recordExecution(db, { ...ref(plan.id), txHash: '0xabc', sent: sentBy(ARM_ADDRESS) })).rejects.toMatchObject({
      code: 'missing_tx_hash',
    })
    await expect(recordExecution(db, { ...ref(plan.id, bob), txHash: TX, sent: sentBy(ARM_ADDRESS) })).rejects.toMatchObject({
      code: 'not_found',
    })
  })

  /** The report is the only writer of this edge: the generic transition cannot skip the sender check. */
  it('is the only way from approved to submitted', async () => {
    const plan = await approvedPlan()
    await handOff(db, ref(plan.id))
    await expect(
      transition(db, { ...ref(plan.id), to: 'submitted', detail: { txHash: TX } }),
    ).rejects.toMatchObject({ code: 'illegal_transition' })
    expect((await findPlan(db, alice, plan.id))?.plan.status).toBe('approved')
  })
})

describe('the status check constraint', () => {
  it('takes approved, and still refuses a status outside the vocabulary', async () => {
    const plan = planFor(alice)
    await createPlan(db, { plan, walletId: agentArm })
    await db.insert(schema.planEvents).values({ planId: plan.id, planVersion: 1, status: 'approved' })
    await expect(
      pg.query(`insert into plan_events (plan_id, plan_version, status) values ($1, 1, 'approved_by_rule')`, [plan.id]),
    ).rejects.toThrow(/plan_events_status/)
  })
})
