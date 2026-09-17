import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { userIdForDid } from '../auth/session.js'
import * as schema from '../db/schema.js'
import { MAX_ARMS } from './reconcile.js'
import { WalletError, addWatchOnlyWallet, listWallets } from './store.js'

/**
 * The eight-arm cap under genuine concurrency.
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
const DID = 'did:privy:concurrency-cap'

const connect = () => {
  const sql = postgres(URL!, { max: 1, prepare: false })
  return { sql, db: drizzle(sql, { schema, casing: 'snake_case' }) }
}

const address = (n: number) => `0x${n.toString(16).padStart(40, '0')}`

describe.skipIf(!URL)('the cap holds against two connections', () => {
  const a = connect()
  const b = connect()

  afterAll(async () => {
    await a.sql`delete from linked_wallets where user_id in (select id from users where privy_did = ${DID})`
    await a.sql`delete from users where privy_did = ${DID}`
    await Promise.all([a.sql.end(), b.sql.end()])
  })

  beforeEach(async () => {
    await a.sql`delete from linked_wallets where user_id in (select id from users where privy_did = ${DID})`
  })

  /**
   * Seven arms, then two requests arriving together. Without the per-user lock
   * both read seven, both see room, and the user ends up with nine — no
   * constraint catches it, because the addresses differ.
   */
  it('refuses the ninth arm when two requests race for the last slot', async () => {
    const userId = await userIdForDid(a.db, DID)
    for (let i = 0; i < MAX_ARMS - 1; i++) {
      await addWatchOnlyWallet(a.db, userId, { address: address(i) })
    }

    const results = await Promise.allSettled([
      addWatchOnlyWallet(a.db, userId, { address: address(101) }),
      addWatchOnlyWallet(b.db, userId, { address: address(102) }),
    ])

    const fulfilled = results.filter((r) => r.status === 'fulfilled')
    const rejected = results.filter((r) => r.status === 'rejected')

    expect(fulfilled).toHaveLength(1)
    expect(rejected).toHaveLength(1)
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(WalletError)
    expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({
      code: 'too_many_wallets',
    })

    const active = await listWallets(a.db, userId)
    expect(active).toHaveLength(MAX_ARMS)
  })

  it('lets both through when there is room for both', async () => {
    const userId = await userIdForDid(a.db, DID)
    for (let i = 0; i < MAX_ARMS - 2; i++) {
      await addWatchOnlyWallet(a.db, userId, { address: address(i) })
    }

    await Promise.all([
      addWatchOnlyWallet(a.db, userId, { address: address(101) }),
      addWatchOnlyWallet(b.db, userId, { address: address(102) }),
    ])

    expect(await listWallets(a.db, userId)).toHaveLength(MAX_ARMS)
  })

  /** The lock is per user, so one person's writes must not block another's. */
  it('does not serialise across users', async () => {
    const mine = await userIdForDid(a.db, DID)
    const theirs = await userIdForDid(b.db, `${DID}-other`)
    try {
      await Promise.all([
        addWatchOnlyWallet(a.db, mine, { address: address(201) }),
        addWatchOnlyWallet(b.db, theirs, { address: address(202) }),
      ])
      expect(await listWallets(a.db, mine)).toHaveLength(1)
      expect(await listWallets(b.db, theirs)).toHaveLength(1)
    } finally {
      await a.sql.begin(async (tx) => {
        await tx`delete from linked_wallets where user_id = ${theirs}`
        await tx`delete from users where id = ${theirs}`
      })
    }
  })
})
