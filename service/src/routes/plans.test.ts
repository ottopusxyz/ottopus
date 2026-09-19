import { PGlite } from '@electric-sql/pglite'
import { drizzle } from 'drizzle-orm/pglite'
import type { MiddlewareHandler } from 'hono'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { userIdForDid } from '../auth/session.js'
import { migrationFiles, statementsIn } from '../db/migrate.js'
import * as schema from '../db/schema.js'
import { inMinutes, planFor } from '../plans/fixtures.js'
import { supersedePlan } from '../plans/review-link.js'
import { createPlan, mintReviewToken, transition } from '../plans/store.js'
import { planRoutes } from './plans.js'

/**
 * The routes with a stub session. The store has its own tests; what matters
 * here is the status codes, the tenant boundary at the HTTP surface, and that
 * a browser cannot write a status it has no business writing.
 */
let db: ReturnType<typeof drizzle<typeof schema>>
let pg: PGlite
let alice: string
let bob: string

const signedInAs = (userId: string): MiddlewareHandler => {
  return async (c, next) => {
    c.set('userId', userId)
    await next()
  }
}

const readPortfolio = async () =>
  ({
    chains: [{ chainId: 'eip155:8453', name: 'Base', iconUrl: 'https://cdn/base.png', value: 1, share: 1 }],
    assets: [
      {
        assetId: 'eip155:8453/slip44:60',
        chainId: 'eip155:8453',
        asset: { symbol: 'ETH', name: 'Ether', decimals: 18, iconUrl: 'https://cdn/eth.png', verified: true },
        amount: '1',
        value: 1,
        price: 1,
        change1d: 0,
        share: 1,
        holdings: [],
      },
    ],
  }) as never

const app = (userId: string, portfolio: typeof readPortfolio | null = readPortfolio) =>
  planRoutes(db, signedInAs(userId), { webUrl: 'https://ottopus.test/', readPortfolio: portfolio })

const post = (userId: string, path: string, body: unknown) =>
  app(userId).request(path, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })

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
  await pg.exec(`truncate review_tokens, simulations, plan_events, plans`)
})

const link = (planId: string, version = 1) =>
  mintReviewToken(db, { planId, version, expiresAt: new Date(inMinutes(10)) })

describe('GET /?pending=1', () => {
  it('lists what is waiting on the caller, with a count', async () => {
    const mine = planFor(alice)
    await createPlan(db, { plan: mine })
    await createPlan(db, { plan: planFor(bob) })

    const res = await app(alice).request('/?pending=1')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { plans: { id: string; summary: string }[]; count: number }
    expect(body.count).toBe(1)
    expect(body.plans.map((p) => p.id)).toEqual([mine.id])
    expect(body.plans[0]!.summary).toBe(mine.humanPlan.summary)
    // A list row carries no calls.
    expect(JSON.stringify(body)).not.toContain('"calls"')
  })

  it('lists every status without the flag, pending first, with icons and prices beside each row', async () => {
    const done = planFor(alice)
    const waiting = planFor(alice)
    await createPlan(db, { plan: done })
    await transition(db, { userId: alice, planId: done.id, version: 1, to: 'cancelled' })
    await createPlan(db, { plan: waiting })

    const res = await app(alice).request('/')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { plans: { id: string; status: string; assetIconUrl: string | null; chainIconUrl: string | null; valueUsd: number | null }[]; count: number }
    expect(body.count).toBe(2)
    expect(body.plans.map((p) => [p.id, p.status])).toEqual([[waiting.id, 'awaiting_review'], [done.id, 'cancelled']])
    expect(body.plans[0]).toMatchObject({ assetIconUrl: 'https://cdn/eth.png', chainIconUrl: 'https://cdn/base.png', valueUsd: 1e-15 })
  })
})

describe('GET /:token', () => {
  it('returns the plan behind a live link, to its owner', async () => {
    const plan = planFor(alice)
    await createPlan(db, { plan })
    const { token } = await link(plan.id)

    const res = await app(alice).request(`/${token}`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      plan: { id: string; planHash: string }
      link: { expiresAt: string }
      visuals: { assets: Record<string, unknown>; chains: Record<string, unknown> }
    }
    expect(body.plan.id).toBe(plan.id)
    expect(body.plan.planHash).toBe(plan.planHash)
    expect(body.link.expiresAt).toBeDefined()
    // Beside the plan, never inside it: the hash is over body.plan alone.
    expect(body.visuals.chains['eip155:8453']).toEqual({ name: 'Base', iconUrl: 'https://cdn/base.png' })
    expect(body.visuals.assets['eip155:8453/slip44:60']).toMatchObject({ symbol: 'ETH', iconUrl: 'https://cdn/eth.png' })
  })

  it('still answers the plan when the balance provider is down or absent', async () => {
    const plan = planFor(alice)
    await createPlan(db, { plan })
    const { token } = await link(plan.id)
    const down = async () => {
      throw new Error('zerion 503')
    }
    for (const portfolio of [null, down as never]) {
      const res = await app(alice, portfolio).request(`/${token}`)
      expect(res.status).toBe(200)
      const body = (await res.json()) as { plan: { id: string }; visuals: { assets: object; chains: object } }
      expect(body.plan.id).toBe(plan.id)
      expect(body.visuals).toEqual({ assets: {}, chains: {}, wallets: {} })
    }
  })

  /**
   * #37's four: tampered, expired, superseded, someone else's. All the same
   * 404, because the page must not hint at what a dead link used to open.
   */
  it('is one 404 for a tampered, expired or superseded token, and for someone else’s link', async () => {
    const plan = planFor(alice)
    await createPlan(db, { plan })
    const { token } = await link(plan.id)
    const expired = await mintReviewToken(db, { planId: plan.id, version: 1, expiresAt: new Date(inMinutes(-1)) })

    expect((await app(alice).request('/nope')).status).toBe(404)
    expect((await app(alice).request(`/${token.slice(0, -1)}x`)).status).toBe(404)
    expect((await app(alice).request(`/${expired.token}`)).status).toBe(404)
    expect((await app(bob).request(`/${token}`)).status).toBe(404)

    await createPlan(db, { plan: planFor(alice, { id: plan.id, version: 2 }) })
    await supersedePlan(db, { userId: alice, planId: plan.id, version: 1 })
    expect((await app(alice).request(`/${token}`)).status).toBe(404)
  })
})

describe('POST /:id/events', () => {
  it('moves the plan and answers with the new status', async () => {
    const plan = planFor(alice)
    await createPlan(db, { plan })
    const res = await post(alice, `/${plan.id}/events`, { version: 1, status: 'awaiting_signature' })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ status: 'awaiting_signature' })
  })

  it('answers 409 when the machine says no', async () => {
    const plan = planFor(alice)
    await createPlan(db, { plan })
    const res = await post(alice, `/${plan.id}/events`, { version: 1, status: 'confirmed' })
    expect(res.status).toBe(409)
    expect(((await res.json()) as { error: string }).error).toBe('illegal_transition')
  })

  it('requires a transaction hash to submit, and keeps it', async () => {
    const plan = planFor(alice)
    await createPlan(db, { plan })
    await transition(db, { userId: alice, planId: plan.id, version: 1, to: 'awaiting_signature' })

    expect((await post(alice, `/${plan.id}/events`, { version: 1, status: 'submitted' })).status).toBe(400)
    expect((await post(alice, `/${plan.id}/events`, { version: 1, status: 'submitted', detail: { txHash: '0x12' } })).status).toBe(400)

    const tx = `0x${'cd'.repeat(32)}`
    const ok = await post(alice, `/${plan.id}/events`, { version: 1, status: 'submitted', detail: { txHash: tx } })
    expect(ok.status).toBe(200)
    const [last] = await db.select().from(schema.planEvents).orderBy(schema.planEvents.seq).offset(2)
    expect(last!.detail).toEqual({ txHash: tx })
  })

  it('refuses statuses a browser may not write', async () => {
    const plan = planFor(alice)
    await createPlan(db, { plan })
    for (const status of ['blocked', 'expired', 'superseded', 'draft', 'inked']) {
      const res = await post(alice, `/${plan.id}/events`, { version: 1, status })
      expect(res.status, status).toBe(400)
    }
  })

  it('answers 404 for someone else’s plan, a missing one, and a malformed id', async () => {
    const plan = planFor(alice)
    await createPlan(db, { plan })
    expect((await post(bob, `/${plan.id}/events`, { version: 1, status: 'cancelled' })).status).toBe(404)
    expect((await post(alice, `/11111111-2222-3333-4444-555555555555/events`, { version: 1, status: 'cancelled' })).status).toBe(404)
    expect((await post(alice, `/not-a-uuid/events`, { version: 1, status: 'cancelled' })).status).toBe(404)
  })

  it('answers 400 for a body that is not an event', async () => {
    const plan = planFor(alice)
    await createPlan(db, { plan })
    expect((await post(alice, `/${plan.id}/events`, { status: 'cancelled' })).status).toBe(400)
    const raw = await app(alice).request(`/${plan.id}/events`, { method: 'POST', body: 'nope' })
    expect(raw.status).toBe(400)
  })
})

describe('POST /:id/link', () => {
  it('mints a link to my own pending plan, as a full URL', async () => {
    const plan = planFor(alice)
    await createPlan(db, { plan })
    const res = await post(alice, `/${plan.id}/link`, {})
    expect(res.status).toBe(201)
    const { token, url } = (await res.json()) as { token: string; url: string }
    expect(url).toBe(`https://ottopus.test/review/${token}`)
    expect((await app(alice).request(`/${token}`)).status).toBe(200)
  })

  it('never outlives the plan', async () => {
    const plan = planFor(alice, { expiresAt: inMinutes(2) })
    await createPlan(db, { plan })
    const { expiresAt } = (await (await post(alice, `/${plan.id}/link`, {})).json()) as { expiresAt: string }
    expect(expiresAt).toBe(plan.expiresAt)
  })

  it('links a settled plan too, so a history row opens to its ended state', async () => {
    const plan = planFor(alice)
    await createPlan(db, { plan })
    await transition(db, { userId: alice, planId: plan.id, version: 1, to: 'cancelled' })
    const res = await post(alice, `/${plan.id}/link`, {})
    expect(res.status).toBe(201)
    const { token } = (await res.json()) as { token: string }
    const read = await app(alice).request(`/${token}`)
    expect(((await read.json()) as { plan: { status: string } }).plan.status).toBe('cancelled')
  })

  /** A history row for an expired plan must open, not mint a link dead on arrival. */
  it('gives an expired plan a read-only link that outlives the plan', async () => {
    const plan = planFor(alice, { expiresAt: inMinutes(-30) })
    await createPlan(db, { plan })
    const res = await post(alice, `/${plan.id}/link`, {})
    expect(res.status).toBe(201)
    const { token, expiresAt } = (await res.json()) as { token: string; expiresAt: string }
    expect(Date.parse(expiresAt)).toBeGreaterThan(Date.now())
    const read = await app(alice).request(`/${token}`)
    expect(read.status).toBe(200)
    expect(((await read.json()) as { plan: { status: string } }).plan.status).toBe('expired')
  })

  it('returns the transaction hash once a plan is submitted, so a reopened page can keep watching', async () => {
    const plan = planFor(alice)
    await createPlan(db, { plan })
    await transition(db, { userId: alice, planId: plan.id, version: 1, to: 'awaiting_signature' })
    const tx = `0x${'ef'.repeat(32)}`
    await transition(db, { userId: alice, planId: plan.id, version: 1, to: 'submitted', detail: { txHash: tx } })
    const { token } = await link(plan.id)
    const body = (await (await app(alice).request(`/${token}`)).json()) as { plan: { status: string }; statusDetail: { txHash: string } }
    expect(body.plan.status).toBe('submitted')
    expect(body.statusDetail).toEqual({ txHash: tx })
  })

  it('is a 404 for someone else’s plan', async () => {
    const plan = planFor(alice)
    await createPlan(db, { plan })
    expect((await post(bob, `/${plan.id}/link`, {})).status).toBe(404)
  })
})
