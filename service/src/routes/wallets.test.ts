import { PGlite } from '@electric-sql/pglite'
import { drizzle } from 'drizzle-orm/pglite'
import type { MiddlewareHandler } from 'hono'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { PrivyWallet } from '../auth/privy.js'
import { userIdForDid } from '../auth/session.js'
import { migrationFiles, statementsIn } from '../db/migrate.js'
import * as schema from '../db/schema.js'
import { walletRoutes } from './wallets.js'

/**
 * The routes are exercised with a stub session rather than a real Privy token:
 * token verification has its own tests, and what matters here is what each
 * route does once it knows who is calling and what was attested.
 */
let db: ReturnType<typeof drizzle<typeof schema>>
let pg: PGlite
let userId: string

const address = (n: number) => `0x${n.toString(16).padStart(40, '0')}`

const wallet = (n: number): PrivyWallet => ({
  address: address(n),
  walletClientType: 'metamask',
  chainType: 'ethereum',
  firstVerifiedAt: '2026-09-01T10:00:00.000Z',
})

/** Stands in for requireSession. `attested` undefined means no identity token. */
const signedIn = (attested: PrivyWallet[] | undefined, as = userId): MiddlewareHandler => {
  return async (c, next) => {
    c.set('userId', as)
    c.set('privyWallets', attested)
    await next()
  }
}

const app = (attested?: PrivyWallet[] | undefined) => walletRoutes(db, signedIn(attested))

/** The same routes, as a different person. */
const appAs = (as: string) => walletRoutes(db, signedIn(undefined, as))

beforeAll(async () => {
  pg = await PGlite.create()
  await pg.exec(`create role anon; create role authenticated; create role service_role;`)
  for (const file of await migrationFiles(new URL('../../drizzle', import.meta.url).pathname)) {
    for (const stmt of await statementsIn(file)) await pg.exec(stmt)
  }
  db = drizzle(pg, { schema, casing: 'snake_case' })
  userId = await userIdForDid(db, 'did:privy:routes')
}, 60_000)

beforeEach(async () => {
  await pg.exec(`delete from linked_wallets`)
})

const post = (a: PrivyWallet[] | undefined, path: string, body?: unknown) =>
  app(a).request(path, {
    method: 'POST',
    ...(body === undefined
      ? {}
      : { body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } }),
  })

describe('POST /sync', () => {
  it('links what the identity token attests', async () => {
    const res = await post([wallet(1)], '/sync')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { wallets: { address: string }[] }
    expect(body.wallets.map((w) => w.address)).toEqual([address(1)])
  })

  /**
   * The one that could unlink someone's entire account. An absent identity
   * token looks identical to "Privy attests nothing", and syncing on that
   * would drop every proved arm. It has to be refused, not treated as empty.
   */
  it('refuses a sync with no identity token instead of unlinking everything', async () => {
    await post([wallet(1)], '/sync')

    const res = await post(undefined, '/sync')
    expect(res.status).toBe(400)
    expect((await res.json()) as { error: string }).toMatchObject({
      error: 'identity_token_required',
    })

    const after = await app([wallet(1)]).request('/')
    expect(((await after.json()) as { wallets: unknown[] }).wallets).toHaveLength(1)
  })

  /** An attestation that genuinely lists nothing is a real unlink, though. */
  /**
   * The route-level half of the access-token substitution. `readIdentity` now
   * reports undefined rather than [] for a token with no linked_accounts
   * claim, and this is what that buys: the sync is refused instead of taken as
   * "this user has no wallets".
   */
  it('refuses a token that carried no linked_accounts claim', async () => {
    await post([wallet(1)], '/sync')

    // What the middleware sets when readIdentity found no readable claim.
    const res = await post(undefined, '/sync')
    expect(res.status).toBe(400)

    const after = await app([wallet(1)]).request('/')
    expect(((await after.json()) as { wallets: unknown[] }).wallets).toHaveLength(1)
  })

  it('does unlink when the token attests an empty list', async () => {
    await post([wallet(1)], '/sync')
    const res = await post([], '/sync')
    expect(((await res.json()) as { wallets: unknown[] }).wallets).toEqual([])
  })
})

describe('POST /watch', () => {
  it('stores a pasted address as watch-only', async () => {
    const res = await post(undefined, '/watch', { address: address(5), label: 'Treasury' })
    expect(res.status).toBe(201)
    const { wallet: arm } = (await res.json()) as { wallet: { isWatchOnly: boolean; label: string } }
    expect(arm).toMatchObject({ isWatchOnly: true, label: 'Treasury' })
  })

  it('rejects a malformed address with 400', async () => {
    expect((await post(undefined, '/watch', { address: '0x123' })).status).toBe(400)
  })

  it('rejects an empty body with 400', async () => {
    expect((await post(undefined, '/watch')).status).toBe(400)
  })

  it('answers 409 for an address already linked', async () => {
    await post(undefined, '/watch', { address: address(5) })
    expect((await post(undefined, '/watch', { address: address(5) })).status).toBe(409)
  })

  it('answers 422 once the arms are full', async () => {
    for (let i = 0; i < 8; i++) await post(undefined, '/watch', { address: address(i) })
    expect((await post(undefined, '/watch', { address: address(99) })).status).toBe(422)
  })
})

describe('PATCH /:id', () => {
  const patch = (id: string, body: unknown, as?: string) =>
    (as ? appAs(as) : app()).request(`/${id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })

  it('renames an arm and changes its kind, and the change is what the list shows', async () => {
    const created = await post(undefined, '/watch', { address: address(5), label: 'Pasted' })
    const { wallet: arm } = (await created.json()) as { wallet: { id: string } }

    const res = await patch(arm.id, { label: 'Treasury', walletType: 'safe' })
    expect(res.status).toBe(200)
    expect((await res.json()) as unknown).toMatchObject({ wallet: { id: arm.id, label: 'Treasury', walletType: 'safe', isWatchOnly: true } })

    const list = (await (await app().request('/')).json()) as { wallets: { label: string | null; walletType: string }[] }
    expect(list.wallets[0]).toMatchObject({ label: 'Treasury', walletType: 'safe' })
  })

  it('clears a label with null and leaves the kind alone', async () => {
    const created = await post(undefined, '/watch', { address: address(6), label: 'Pasted', walletType: 'safe' })
    const { wallet: arm } = (await created.json()) as { wallet: { id: string } }
    const res = await patch(arm.id, { label: null })
    expect((await res.json()) as unknown).toMatchObject({ wallet: { label: null, walletType: 'safe' } })
  })

  it('refuses a kind it has no word for, an empty edit, and a bad body', async () => {
    const created = await post(undefined, '/watch', { address: address(8) })
    const { wallet: arm } = (await created.json()) as { wallet: { id: string } }
    expect((await patch(arm.id, { walletType: 'abacus' })).status).toBe(400)
    expect((await patch(arm.id, {})).status).toBe(400)
    expect((await app().request(`/${arm.id}`, { method: 'PATCH', body: 'not json' })).status).toBe(400)
  })

  it('answers 404 for a wallet belonging to someone else, or none at all', async () => {
    const stranger = await userIdForDid(db, 'did:privy:someone-else-editing')
    const created = await post(undefined, '/watch', { address: address(9) })
    const { wallet: arm } = (await created.json()) as { wallet: { id: string } }
    expect((await patch(arm.id, { label: 'Mine now' }, stranger)).status).toBe(404)
    expect((await patch('11111111-2222-3333-4444-555555555555', { label: 'x' })).status).toBe(404)
    expect((await patch('nope', { label: 'x' })).status).toBe(404)
  })
})

describe('DELETE /:id', () => {
  it('unlinks an arm', async () => {
    const created = await post(undefined, '/watch', { address: address(5) })
    const { wallet: arm } = (await created.json()) as { wallet: { id: string } }

    const res = await app().request(`/${arm.id}`, { method: 'DELETE' })
    expect(res.status).toBe(204)

    const list = await app().request('/')
    expect(((await list.json()) as { wallets: unknown[] }).wallets).toEqual([])
  })

  it('answers 404 for an id that does not exist', async () => {
    const missing = '11111111-2222-3333-4444-555555555555'
    expect((await app().request(`/${missing}`, { method: 'DELETE' })).status).toBe(404)
  })

  /** A malformed uuid is a bad request, not a database error surfacing as 500. */
  it('answers 404 for a malformed id', async () => {
    expect((await app().request('/not-a-uuid', { method: 'DELETE' })).status).toBe(404)
  })

  /**
   * Another person's wallet id must look exactly like a missing one, and the
   * wallet must still be there for its owner afterwards.
   */
  it('answers 404 for a wallet belonging to someone else, and leaves it linked', async () => {
    const stranger = await userIdForDid(db, 'did:privy:someone-else')
    const created = await post(undefined, '/watch', { address: address(7) })
    const { wallet: arm } = (await created.json()) as { wallet: { id: string } }

    expect((await appAs(stranger).request(`/${arm.id}`, { method: 'DELETE' })).status).toBe(404)

    const list = await app().request('/')
    const { wallets } = (await list.json()) as { wallets: { id: string }[] }
    expect(wallets.map((w) => w.id)).toEqual([arm.id])
    expect(((await appAs(stranger).request('/').then((r) => r.json())) as { wallets: unknown[] }).wallets).toEqual([])
  })
})
