import { PGlite } from '@electric-sql/pglite'
import { drizzle } from 'drizzle-orm/pglite'
import { beforeAll, describe, expect, it } from 'vitest'
import * as schema from '../db/schema.js'
import { migrationFiles, statementsIn } from '../db/migrate.js'
import { userIdForDid } from './session.js'

/**
 * Against real Postgres, because the thing being tested is a Postgres
 * behaviour: whether ON CONFLICT actually returns the existing row. A mocked
 * database would return whatever the mock was told to.
 */
let db: ReturnType<typeof drizzle<typeof schema>>
let pg: PGlite

const DID = 'did:privy:signed-in-once'

beforeAll(async () => {
  pg = await PGlite.create()
  await pg.exec(`create role anon; create role authenticated; create role service_role;`)
  for (const file of await migrationFiles(new URL('../../drizzle', import.meta.url).pathname)) {
    for (const stmt of await statementsIn(file)) await pg.exec(stmt)
  }
  db = drizzle(pg, { schema, casing: 'snake_case' })
}, 60_000)

const count = async (did: string) => {
  const res = await pg.query<{ n: number }>(
    `select count(*)::int as n from users where privy_did = $1`,
    [did],
  )
  return res.rows[0]!.n
}

describe('a Privy DID resolves to one user', () => {
  it('creates the user on a first authenticated request', async () => {
    const id = await userIdForDid(db, DID)
    expect(id).toMatch(/^[0-9a-f-]{36}$/)
    expect(await count(DID)).toBe(1)
  })

  it('returns the same id on every request after that', async () => {
    const first = await userIdForDid(db, DID)
    const second = await userIdForDid(db, DID)
    expect(second).toBe(first)
    expect(await count(DID)).toBe(1)
  })

  /**
   * Two requests from one new session arrive together often enough to matter —
   * the web app calls /me while the page is also loading. A read-then-insert
   * would lose that race and 500 one of them.
   */
  it('creates exactly one row when concurrent requests race', async () => {
    const did = 'did:privy:raced'
    const ids = await Promise.all(
      Array.from({ length: 8 }, () => userIdForDid(db, did)),
    )
    expect(new Set(ids).size).toBe(1)
    expect(await count(did)).toBe(1)
  })

  it('keeps separate people separate', async () => {
    const a = await userIdForDid(db, 'did:privy:alice')
    const b = await userIdForDid(db, 'did:privy:bob')
    expect(a).not.toBe(b)
  })
})
