import { Hono, type MiddlewareHandler } from 'hono'
import { z } from 'zod'
import { isPending } from '../core/index.js'
import {
  type PlanDb,
  PlanError,
  TX_HASH,
  findPlan,
  issueReviewLink,
  listPending,
  resolveReviewToken,
  summarise,
  transition,
} from '../plans/index.js'

/**
 * The web's view of plans. Three things: what is waiting on me, what is behind
 * this review link, and the handful of transitions a browser is allowed to
 * make. Building plans is the MCP surface's job (#17); the web never builds
 * one and never verifies one — it renders what the service already proved.
 */

/**
 * What the browser may write. Not `blocked` (verify decides that), not
 * `expired` (derived, and later a job), not `superseded` (a new version does
 * that). A browser asking for any of those is a bug or an attack, and either
 * way the answer is a 400 from the schema.
 */
const WEB_TRANSITIONS = [
  'awaiting_review',
  'awaiting_signature',
  'submitted',
  'confirmed',
  'failed',
  'cancelled',
] as const

const version = z.number().int().positive()
const detail = z.record(z.string(), z.unknown()).optional()

/**
 * `submitted` is the one transition with a required payload: the transaction
 * hash is what receipt tracking (#20, later #40) polls, and a submission with
 * nothing to poll would be a plan that can neither expire nor be cancelled nor
 * ever confirm. The store refuses it too; this is the 400 with a clear reason.
 */
const eventSchema = z.discriminatedUnion('status', [
  z.object({
    version,
    status: z.literal('submitted'),
    detail: z.object({ txHash: z.string().regex(TX_HASH, 'expected a 0x-prefixed 32-byte hash') }).passthrough(),
  }),
  z.object({
    version,
    status: z.enum(WEB_TRANSITIONS.filter((s) => s !== 'submitted') as [string, ...string[]]),
    detail,
  }),
])

const isUuid = (id: string) => z.uuid().safeParse(id).success

export function planRoutes(db: PlanDb, session: MiddlewareHandler, webUrl: string): Hono {
  const app = new Hono()
  app.use('*', session)

  /**
   * Only the pending list is served today. Activity (#26) will want history,
   * with its own paging; refusing anything else now keeps that from arriving
   * as a silent "list everything" nobody meant to ship.
   */
  app.get('/', async (c) => {
    if (c.req.query('pending') !== '1') {
      return c.json({ error: 'unsupported', detail: 'only ?pending=1 is served' }, 400)
    }
    const records = await listPending(db, c.get('userId'))
    return c.json({ plans: records.map(summarise), count: records.length })
  })

  /**
   * The plan behind a review link. A dead token, a wrong one, and someone
   * else's plan are all the same 404 — the page says "no longer live" and
   * never hints at what the link used to be.
   */
  app.get('/:token', async (c) => {
    const record = await resolveReviewToken(db, c.get('userId'), c.req.param('token'))
    if (!record) return c.json({ error: 'not_found' }, 404)
    return c.json({
      plan: record.plan,
      walletId: record.walletId,
      statusAt: record.statusAt,
      link: { expiresAt: record.linkExpiresAt },
    })
  })

  /**
   * A transition. 409 when the machine says no, so the page can tell
   * "someone cancelled this from chat" apart from "this never existed".
   */
  app.post('/:id/events', async (c) => {
    const id = c.req.param('id')
    if (!isUuid(id)) return c.json({ error: 'not_found' }, 404)
    const body = eventSchema.safeParse(await c.req.json().catch(() => null))
    if (!body.success) return c.json({ error: 'invalid_body' }, 400)

    try {
      const status = await transition(db, {
        userId: c.get('userId'),
        planId: id,
        version: body.data.version,
        to: body.data.status as (typeof WEB_TRANSITIONS)[number],
        detail: body.data.detail,
      })
      return c.json({ status })
    } catch (err) {
      if (err instanceof PlanError && err.code === 'not_found') return c.json({ error: 'not_found' }, 404)
      if (err instanceof PlanError && err.code === 'illegal_transition') {
        return c.json({ error: 'illegal_transition', detail: err.message }, 409)
      }
      throw err
    }
  })

  /**
   * A fresh link to my own plan, for the Requests row. Tokens are stored
   * hashed, so the one the agent got cannot be read back; minting another is
   * the honest answer. Only for a plan that is still waiting on me.
   */
  app.post('/:id/link', async (c) => {
    const id = c.req.param('id')
    if (!isUuid(id)) return c.json({ error: 'not_found' }, 404)
    const record = await findPlan(db, c.get('userId'), id)
    if (!record) return c.json({ error: 'not_found' }, 404)
    if (!isPending(record.plan.status)) return c.json({ error: 'not_pending', status: record.plan.status }, 409)

    const link = await issueReviewLink(
      db,
      { planId: record.plan.id, version: record.plan.version, planExpiresAt: record.plan.expiresAt },
      webUrl,
    )
    return c.json(link, 201)
  })

  return app
}
