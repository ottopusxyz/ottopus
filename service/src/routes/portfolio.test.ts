import { PGlite } from '@electric-sql/pglite'
import { drizzle } from 'drizzle-orm/pglite'
import type { MiddlewareHandler } from 'hono'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { userIdForDid } from '../auth/session.js'
import {
  PortfolioError,
  type AccountPosition,
  type AccountRef,
  type PortfolioConnector,
} from '../connectors/portfolio/index.js'
import { migrationFiles, statementsIn } from '../db/migrate.js'
import * as schema from '../db/schema.js'
import type { Portfolio } from '../connectors/portfolio/index.js'
import { portfolioRoutes } from './portfolio.js'

/**
 * The route with a stub session and a stub connector. What is being checked is
 * the join — that the arms the route reads are this user's active wallets and
 * nobody else's — not Zerion, which has its own tests.
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

function position(value: number): AccountPosition {
  return {
    assetId: 'eip155:8453/erc20:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
    chainId: 'eip155:8453',
    asset: { symbol: 'USDC', name: 'USD Coin', decimals: 6, iconUrl: null, verified: true },
    positionType: 'wallet',
    amount: String(value * 1_000_000),
    value,
    price: 1,
    change1d: 0,
    protocol: null,
    protocolModule: null,
    positionName: null,
    dappId: null,
    dappIconUrl: null,
    dappUrl: null,
    poolAddress: null,
    parentId: null,
    groupId: null,
  }
}

/** Answers with one position worth however many arms have been seen. */
function connector(
  answer: (account: AccountRef) => Promise<AccountPosition[]> = async () => [position(1)],
): PortfolioConnector & { seen: string[] } {
  const seen: string[] = []
  return {
    provider: 'stub',
    seen,
    positionsFor: vi.fn(async (account: AccountRef) => {
      seen.push(account.address)
      return answer(account)
    }),
    chainName: (chainId) => (chainId === 'eip155:8453' ? 'Base' : null),
  }
}

async function linkWallet(owner: string, n: number, watchOnly = false) {
  await db.insert(schema.linkedWallets).values({
    userId: owner,
    address: address(n),
    walletType: watchOnly ? 'watch_only' : 'metamask',
    isWatchOnly: watchOnly,
    ...(watchOnly ? {} : { ownershipProof: { via: 'privy' }, provedAt: new Date() }),
  })
}

beforeAll(async () => {
  pg = await PGlite.create()
  await pg.exec(`create role anon; create role authenticated; create role service_role;`)
  for (const file of await migrationFiles(new URL('../../drizzle', import.meta.url).pathname)) {
    for (const stmt of await statementsIn(file)) await pg.exec(stmt)
  }
  db = drizzle(pg, { schema, casing: 'snake_case' })
  userId = await userIdForDid(db, 'did:privy:portfolio')
  otherUserId = await userIdForDid(db, 'did:privy:someone-else')
}, 60_000)

beforeEach(async () => {
  await pg.exec(`delete from linked_wallets`)
})

const get = (c: PortfolioConnector, as: () => string = () => userId) =>
  portfolioRoutes(db, signedIn(as), c).request('/')

describe('GET /portfolio', () => {
  it('reads every linked arm and adds them up', async () => {
    await linkWallet(userId, 1)
    await linkWallet(userId, 2)

    const stub = connector()
    const res = await get(stub)
    const body = (await res.json()) as Portfolio

    expect(res.status).toBe(200)
    expect(stub.seen.sort()).toEqual([address(1), address(2)])
    expect(body.total).toBe(2)
    expect(body.arms).toHaveLength(2)
  })

  it('reads watch-only arms too — seeing them is why they exist', async () => {
    await linkWallet(userId, 3, true)

    const stub = connector()
    await get(stub)

    expect(stub.seen).toEqual([address(3)])
  })

  it('never reads another user’s arms', async () => {
    await linkWallet(userId, 1)
    await linkWallet(otherUserId, 9)

    const stub = connector()
    await get(stub)

    expect(stub.seen).toEqual([address(1)])
  })

  it('leaves an unlinked arm out', async () => {
    await linkWallet(userId, 1)
    await linkWallet(userId, 2)
    await pg.exec(`update linked_wallets set unlinked_at = now() where address = '${address(2)}'`)

    const stub = connector()
    await get(stub)

    expect(stub.seen).toEqual([address(1)])
  })

  it('is an empty portfolio, not an error, before anything is linked', async () => {
    const stub = connector()
    const res = await get(stub)
    const body = (await res.json()) as Portfolio

    expect(res.status).toBe(200)
    expect(body).toMatchObject({ total: 0, arms: [], assets: [] })
    expect(stub.seen).toEqual([])
  })

  it('still answers when one arm cannot be read, and says which', async () => {
    await linkWallet(userId, 1)
    await linkWallet(userId, 2)

    const stub = connector(async (account) => {
      if (account.address === address(2)) {
        throw new PortfolioError('untracked_address', 'not trackable')
      }
      return [position(5)]
    })

    const res = await get(stub)
    const body = (await res.json()) as Portfolio

    expect(res.status).toBe(200)
    expect(body.total).toBe(5)
    const failed = body.arms.find((a) => a.address === address(2))!
    expect(failed.status).toBe('untracked_address')
    expect(body.arms.find((a) => a.address === address(1))!.status).toBe('ok')
  })

  it('names the provider and the chains, so the page prints neither slug nor guess', async () => {
    await linkWallet(userId, 1)

    const body = (await (await get(connector())).json()) as Portfolio

    expect(body.provider).toBe('stub')
    expect(body.currency).toBe('usd')
    expect(body.chains).toEqual([
      { chainId: 'eip155:8453', name: 'Base', iconUrl: null, value: 1, share: 1 },
    ])
  })
})
