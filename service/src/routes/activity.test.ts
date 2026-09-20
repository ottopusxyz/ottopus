import { PGlite } from '@electric-sql/pglite'
import { drizzle } from 'drizzle-orm/pglite'
import type { MiddlewareHandler } from 'hono'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { userIdForDid } from '../auth/session.js'
import type { ActivityConnector, ActivityFeed, ActivityQuery } from '../connectors/activity/index.js'
import type { AccountRef } from '../connectors/portfolio/index.js'
import { migrationFiles, statementsIn } from '../db/migrate.js'
import * as schema from '../db/schema.js'
import { activityRoutes } from './activity.js'

/**
 * The route with a stub session and a stub connector. What is being checked
 * is the join and the query — that the arms read are this user's, that a
 * wallet filter narrows to one of them, that the filters reach the provider —
 * not the merge, which has its own tests.
 */
let db: ReturnType<typeof drizzle<typeof schema>>
let pg: PGlite
let userId: string
let otherUserId: string

const address = (n: number) => `0x${n.toString(16).padStart(40, '0')}`

const signedIn = (id: () => string): MiddlewareHandler => async (c, next) => {
  c.set('userId', id())
  await next()
}

function connector(): ActivityConnector & { asked: { address: string; query: ActivityQuery }[] } {
  const asked: { address: string; query: ActivityQuery }[] = []
  return {
    provider: 'stub',
    asked,
    transactionsFor: vi.fn(async (account: AccountRef, query: ActivityQuery) => {
      asked.push({ address: account.address, query })
      return { items: [], more: false }
    }),
  }
}

async function linkWallet(owner: string, n: number): Promise<string> {
  const [row] = await db
    .insert(schema.linkedWallets)
    .values({ userId: owner, address: address(n), walletType: 'metamask', isWatchOnly: false, ownershipProof: { via: 'privy' }, provedAt: new Date() })
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
  userId = await userIdForDid(db, 'did:privy:activity')
  otherUserId = await userIdForDid(db, 'did:privy:someone-else')
}, 60_000)

beforeEach(async () => {
  await pg.exec(`delete from linked_wallets`)
})

const get = (c: ActivityConnector, search = '', as: () => string = () => userId) =>
  activityRoutes(db, signedIn(as), c).request(`/${search}`)

describe('GET /activity', () => {
  it('reads every linked arm of this user and nobody else’s', async () => {
    await linkWallet(userId, 1)
    await linkWallet(userId, 2)
    await linkWallet(otherUserId, 9)

    const stub = connector()
    const res = await get(stub)
    const body = (await res.json()) as ActivityFeed

    expect(res.status).toBe(200)
    expect(stub.asked.map((a) => a.address).sort()).toEqual([address(1), address(2)])
    expect(body.items).toEqual([])
    expect(body.cursor).toBeNull()
    expect(body.arms.map((a) => a.status)).toEqual(['ok', 'ok'])
  })

  it('narrows to one wallet, and to none for an id that is not this user’s', async () => {
    const mine = await linkWallet(userId, 1)
    await linkWallet(userId, 2)
    const theirs = await linkWallet(otherUserId, 9)

    const stub = connector()
    await get(stub, `?wallet=${mine}`)
    expect(stub.asked.map((a) => a.address)).toEqual([address(1)])

    const other = connector()
    const res = await get(other, `?wallet=${theirs}`)
    expect(res.status).toBe(200)
    expect(other.asked).toEqual([])
  })

  it('hands the filters and the size to the provider', async () => {
    await linkWallet(userId, 1)
    const stub = connector()
    await get(stub, '?kinds=trade,send&chain=eip155:8453&size=10')
    expect(stub.asked[0]?.query).toMatchObject({ kinds: ['trade', 'send'], chainId: 'eip155:8453', size: 10 })
  })

  it('refuses a kind it has no word for, an oversized page, and a cursor it did not write', async () => {
    await linkWallet(userId, 1)
    expect((await get(connector(), '?kinds=teleport')).status).toBe(400)
    expect((await get(connector(), '?size=500')).status).toBe(400)
    expect((await get(connector(), '?chain=solana')).status).toBe(400)
    expect((await get(connector(), '?cursor=nonsense')).status).toBe(400)
  })
})
