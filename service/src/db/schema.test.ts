import { PGlite } from '@electric-sql/pglite'
import { beforeAll, describe, expect, it } from 'vitest'
import { migrationFiles, statementsIn } from './migrate.js'

/**
 * These run the real migrations against real Postgres (PGlite is Postgres
 * compiled to WASM), so they test the database's behaviour rather than our
 * beliefs about it. The append-only guarantees in particular cannot be checked
 * any other way — they are triggers, not application code.
 */
let db: PGlite

const USER = '11111111-1111-1111-1111-111111111111'
const WALLET = '22222222-2222-2222-2222-222222222222'
const PLAN = '33333333-3333-3333-3333-333333333333'

async function seed(): Promise<void> {
  await db.exec(`
    insert into users (id, privy_did) values ('${USER}', 'did:privy:test');
    insert into linked_wallets (id, user_id, address, wallet_type, ownership_proof)
      values ('${WALLET}', '${USER}', '0xabc', 'metamask', '{"sig":"0x1"}'::jsonb);
    insert into plans (id, version, plan_hash, user_id, wallet_id, intent, payload, expires_at)
      values ('${PLAN}', 1, '0xhash', '${USER}', '${WALLET}', '{}'::jsonb, '{}'::jsonb, now() + interval '10 min');
    insert into plan_events (plan_id, plan_version, status) values ('${PLAN}', 1, 'draft');
  `)
}

beforeAll(async () => {
  db = await PGlite.create()
  // Supabase ships these roles; PGlite does not.
  await db.exec(`create role anon; create role authenticated; create role service_role;`)
  for (const file of await migrationFiles(new URL('../../drizzle', import.meta.url).pathname)) {
    for (const stmt of await statementsIn(file)) await db.exec(stmt)
  }
  await seed()
}, 60_000)

describe('plans are append-only', () => {
  it('rejects UPDATE', async () => {
    await expect(db.exec(`update plans set reason = 'tampered' where id = '${PLAN}'`)).rejects.toThrow(
      /append-only/,
    )
  })

  it('rejects DELETE', async () => {
    await expect(db.exec(`delete from plans where id = '${PLAN}'`)).rejects.toThrow(/append-only/)
  })

  it('allows a new version instead', async () => {
    await db.exec(`
      insert into plans (id, version, plan_hash, user_id, intent, payload, expires_at)
      values ('${PLAN}', 2, '0xhash2', '${USER}', '{}'::jsonb, '{}'::jsonb, now() + interval '10 min')
    `)
    const r = await db.query(`select count(*)::int as n from plans where id = '${PLAN}'`)
    expect((r.rows[0] as { n: number }).n).toBe(2)
  })
})

describe('plan_events and simulations are append-only', () => {
  it('rejects UPDATE on plan_events', async () => {
    await expect(
      db.exec(`update plan_events set status = 'confirmed' where plan_id = '${PLAN}'`),
    ).rejects.toThrow(/append-only/)
  })

  it('rejects DELETE on plan_events', async () => {
    await expect(db.exec(`delete from plan_events where plan_id = '${PLAN}'`)).rejects.toThrow(
      /append-only/,
    )
  })

  it('rejects UPDATE on simulations', async () => {
    await db.exec(`
      insert into simulations (plan_id, plan_version, provider, ok)
      values ('${PLAN}', 1, 'tenderly', true)
    `)
    await expect(db.exec(`update simulations set ok = false`)).rejects.toThrow(/append-only/)
  })
})

describe('referential integrity', () => {
  it('rejects a plan_event for an unknown plan', async () => {
    await expect(
      db.exec(
        `insert into plan_events (plan_id, plan_version, status) values ('44444444-4444-4444-4444-444444444444', 1, 'draft')`,
      ),
    ).rejects.toThrow(/foreign key|violates/i)
  })

  it('rejects a plan_event for a version that does not exist', async () => {
    await expect(
      db.exec(`insert into plan_events (plan_id, plan_version, status) values ('${PLAN}', 99, 'draft')`),
    ).rejects.toThrow(/foreign key|violates/i)
  })

  it('rejects a simulation for an unknown plan', async () => {
    await expect(
      db.exec(
        `insert into simulations (plan_id, plan_version, provider, ok) values ('44444444-4444-4444-4444-444444444444', 1, 'tenderly', true)`,
      ),
    ).rejects.toThrow(/foreign key|violates/i)
  })
})

describe('status vocabulary is frozen', () => {
  it('rejects a status outside the vocabulary', async () => {
    await expect(
      db.exec(`insert into plan_events (plan_id, plan_version, status) values ('${PLAN}', 1, 'simulated')`),
    ).rejects.toThrow(/plan_events_status|violates check/i)
  })

  it('accepts every frozen status', async () => {
    for (const s of [
      'draft',
      'awaiting_review',
      'awaiting_signature',
      'submitted',
      'confirmed',
      'failed',
      'expired',
      'blocked',
      'superseded',
      'cancelled',
    ]) {
      await db.exec(
        `insert into plan_events (plan_id, plan_version, status) values ('${PLAN}', 1, '${s}')`,
      )
    }
  })
})

describe('wallets are unlinked, never deleted', () => {
  it('refuses to delete a wallet a plan is bound to', async () => {
    // Must fail as a foreign key error, not as a trigger deadlock from the
    // database trying to null the column on an append-only row.
    await expect(db.exec(`delete from linked_wallets where id = '${WALLET}'`)).rejects.toThrow(
      /foreign key|violates/i,
    )
  })

  it('allows re-linking an address after it is unlinked', async () => {
    await db.exec(`update linked_wallets set unlinked_at = now() where id = '${WALLET}'`)
    await db.exec(`
      insert into linked_wallets (user_id, address, wallet_type, ownership_proof)
      values ('${USER}', '0xabc', 'rabby', '{"sig":"0x2"}'::jsonb)
    `)
    const r = await db.query(
      `select count(*)::int as n from linked_wallets where user_id = '${USER}' and address = '0xabc'`,
    )
    expect((r.rows[0] as { n: number }).n).toBe(2)
  })

  it('rejects two active links for the same address', async () => {
    await expect(
      db.exec(`
        insert into linked_wallets (user_id, address, wallet_type, ownership_proof)
        values ('${USER}', '0xabc', 'metamask', '{"sig":"0x3"}'::jsonb)
      `),
    ).rejects.toThrow(/unique|duplicate/i)
  })
})

describe('wallet constraints', () => {
  it('rejects a non-lowercase address', async () => {
    await expect(
      db.exec(`
        insert into linked_wallets (user_id, address, wallet_type, ownership_proof)
        values ('${USER}', '0xABCDEF', 'metamask', '{"sig":"0x4"}'::jsonb)
      `),
    ).rejects.toThrow(/lowercase|violates check/i)
  })

  it('rejects a signing wallet with no ownership proof', async () => {
    await expect(
      db.exec(`
        insert into linked_wallets (user_id, address, wallet_type)
        values ('${USER}', '0xdef', 'metamask')
      `),
    ).rejects.toThrow(/proof_required|violates check/i)
  })

  it('allows a watch-only wallet with no proof', async () => {
    await db.exec(`
      insert into linked_wallets (user_id, address, wallet_type, is_watch_only)
      values ('${USER}', '0xfeed', 'watch_only', true)
    `)
  })
})

describe('RLS denies client roles', () => {
  it('gives anon no access to plans', async () => {
    await db.exec(`set role anon`)
    await expect(db.query(`select * from plans`)).rejects.toThrow(/permission denied/i)
    await db.exec(`reset role`)
  })

  it('gives authenticated no access to linked_wallets', async () => {
    await db.exec(`set role authenticated`)
    await expect(db.query(`select * from linked_wallets`)).rejects.toThrow(/permission denied/i)
    await db.exec(`reset role`)
  })
})
