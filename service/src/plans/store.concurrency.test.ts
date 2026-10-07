import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { userIdForDid } from '../auth/session.js'
import * as schema from '../db/schema.js'
import { updateWallet } from '../wallets/store.js'
import { ACCOUNT, planFor } from './fixtures.js'
import { createPlan, findPlan } from './store.js'

/**
 * The arm's rule under genuine concurrency: a switch flipped off while a plan
 * is being approved by it.
 *
 * Opt-in, because it cannot run on PGlite: PGlite is Postgres compiled to WASM
 * with a single in-process connection, so two "concurrent" transactions there
 * serialise no matter what the code does, and the test would pass with the lock
 * removed. Proving the lock does anything needs two real connections.
 *
 *   TEST_DATABASE_URL=postgres://… pnpm exec vitest run store.concurrency
 *
 * Point it at a scratch database — it writes and deletes rows.
 */
const URL = process.env.TEST_DATABASE_URL
const DID = 'did:privy:concurrency-rule'

const connect = () => {
  const sql = postgres(URL!, { max: 1, prepare: false })
  return { sql, db: drizzle(sql, { schema, casing: 'snake_case' }) }
}

describe.skipIf(!URL)('the rule holds against two connections', () => {
  const a = connect()
  const b = connect()
  let userId: string
  let armId: string

  const wipe = async () => {
    await a.sql`delete from plan_events where plan_id in (select id from plans where user_id = ${userId})`
    await a.sql`delete from plans where user_id = ${userId}`
    await a.sql`delete from linked_wallets where user_id = ${userId}`
  }

  afterAll(async () => {
    await wipe()
    await a.sql`delete from users where id = ${userId}`
    await Promise.all([a.sql.end(), b.sql.end()])
  })

  beforeEach(async () => {
    userId = await userIdForDid(a.db, DID)
    await wipe()
    const [row] = await a.db
      .insert(schema.linkedWallets)
      .values({
        userId,
        address: ACCOUNT.split(':')[2]!,
        walletType: 'agentic',
        agentProvider: 'binance',
        ownershipProof: { signature: '0x01' },
        provedAt: new Date(),
        autoExecute: true,
      })
      .returning({ id: schema.linkedWallets.id })
    armId = row!.id
  })

  /**
   * Hold the arm's row on one connection, the way the approval does, and
   * switch the rule off on the other while it is held. Without the lock the
   * approval's read and the switch-off interleave, and a plan is approved by a
   * rule the person had already turned off. With it, one of two things
   * happens, and both are right: the switch-off lands first and the plan
   * waits for review, or the approval lands first and the plan stays
   * approved, exactly as if the switch had been flipped a moment later.
   * What must never happen is the third: approved, by a rule that was off at
   * the moment of approval.
   */
  it('a switch-off during approval lands before the read or after the commit, never between', async () => {
    const plan = planFor(userId)
    // Hold the arm's row from connection b for a moment, as a switch-off in
    // flight would, so the approval on connection a has to queue behind it.
    const held = b.sql.begin(async (tx) => {
      await tx`select id from linked_wallets where id = ${armId} for update`
      await new Promise((r) => setTimeout(r, 150))
      await tx`update linked_wallets set auto_execute = false where id = ${armId}`
    })
    await new Promise((r) => setTimeout(r, 30))
    const record = await createPlan(a.db, { plan, walletId: armId, approveByRule: true })
    await held

    // The switch-off committed before the approval could read the row, so
    // the approval saw it off.
    expect(record.plan.status).toBe('awaiting_review')
    expect((await findPlan(a.db, userId, plan.id))?.plan.status).toBe('awaiting_review')
  })

  /** The other order: approval holds the row, the switch-off waits for it. */
  it('a switch-off queued behind an approval finds the plan already approved', async () => {
    const plan = planFor(userId)
    const approving = createPlan(a.db, { plan, walletId: armId, approveByRule: true })
    await new Promise((r) => setTimeout(r, 30))
    const switching = updateWallet(b.db, userId, armId, { autoExecute: false })
    const [record, arm] = await Promise.all([approving, switching])

    expect(record.plan.status).toBe('approved')
    expect(arm.autoExecute).toBe(false)
    expect((await findPlan(a.db, userId, plan.id))?.plan.status).toBe('approved')
    const [row] = await a.db
      .select({ autoExecute: schema.linkedWallets.autoExecute })
      .from(schema.linkedWallets)
      .where(eq(schema.linkedWallets.id, armId))
    expect(row?.autoExecute).toBe(false)
  })
})
