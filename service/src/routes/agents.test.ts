import { PGlite } from '@electric-sql/pglite'
import { drizzle } from 'drizzle-orm/pglite'
import type { MiddlewareHandler } from 'hono'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { userIdForDid } from '../auth/session.js'
import { migrationFiles, statementsIn } from '../db/migrate.js'
import * as schema from '../db/schema.js'
import { oauthGrants } from '../db/schema.js'
import { registerClient } from '../oauth/index.js'
import { agentRoutes } from './agents.js'

/**
 * Tenant isolation at the HTTP surface. The store tests already prove that
 * revokeGrant refuses a stranger; this checks that the route never lets one
 * user's session reach another's grants, whichever way the id arrives.
 *
 * Grants are inserted directly rather than through the OAuth dance: how a
 * grant comes to exist is the store's concern, and it has its own tests.
 */
let db: ReturnType<typeof drizzle<typeof schema>>
let pg: PGlite
let alice: string
let bob: string
let clientId: string

/** Stands in for requireSession, as whoever `userId` is. */
const signedInAs = (userId: string): MiddlewareHandler => {
  return async (c, next) => {
    c.set('userId', userId)
    await next()
  }
}

const app = (userId: string) => agentRoutes(db, signedInAs(userId))

async function grantTo(userId: string): Promise<string> {
  const [row] = await db
    .insert(oauthGrants)
    .values({ userId, clientId, scopes: ['wallets:read'] })
    .returning({ id: oauthGrants.id })
  return row!.id
}

async function agentsOf(userId: string): Promise<{ id: string; revokedAt: string | null }[]> {
  const res = await app(userId).request('/')
  expect(res.status).toBe(200)
  return ((await res.json()) as { agents: { id: string; revokedAt: string | null }[] }).agents
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
  const client = await registerClient(db, {
    clientName: 'Test agent',
    redirectUris: ['https://agent.example/callback'],
  })
  clientId = client.clientId
}, 60_000)

beforeEach(async () => {
  await pg.exec(`delete from oauth_grants`)
})

describe('GET /', () => {
  it('lists only the caller’s grants', async () => {
    const mine = await grantTo(alice)
    await grantTo(bob)

    expect((await agentsOf(alice)).map((a) => a.id)).toEqual([mine])
  })

  it('is empty for a user who never authorised anything', async () => {
    await grantTo(bob)
    expect(await agentsOf(alice)).toEqual([])
  })
})

describe('DELETE /:id', () => {
  it('revokes the caller’s own grant', async () => {
    const mine = await grantTo(alice)
    expect((await app(alice).request(`/${mine}`, { method: 'DELETE' })).status).toBe(204)
    expect((await agentsOf(alice))[0]!.revokedAt).not.toBeNull()
  })

  /**
   * Someone else's grant id must look exactly like a missing one. A 403 would
   * confirm the id exists, and a 204 would be a cross-tenant revoke.
   */
  it('answers 404 for a grant belonging to someone else, and leaves it live', async () => {
    const bobs = await grantTo(bob)

    expect((await app(alice).request(`/${bobs}`, { method: 'DELETE' })).status).toBe(404)

    const [grant] = await agentsOf(bob)
    expect(grant!.id).toBe(bobs)
    expect(grant!.revokedAt).toBeNull()
  })

  it('answers 404 for a malformed id', async () => {
    expect((await app(alice).request('/not-a-uuid', { method: 'DELETE' })).status).toBe(404)
  })
})
