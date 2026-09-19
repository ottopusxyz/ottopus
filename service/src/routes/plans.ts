import { Hono, type MiddlewareHandler } from 'hono'
import { z } from 'zod'
import type { ArmRef, Portfolio } from '../connectors/portfolio/index.js'
import type { TokenRegistry } from '../connectors/tokens/index.js'
import { type DecoratedSummary, decorateSummary, visualsFor } from '../plans/visuals.js'
import { type WalletDb, listWallets } from '../wallets/index.js'
import {
  type PlanDb,
  PlanError,
  type PlanSummary,
  TX_HASH,
  findPlan,
  issueReviewLink,
  listPending,
  listPlans,
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

export interface PlanRouteDeps {
  webUrl: string
  /** Null when no balance provider is configured; the page then draws no icons. */
  readPortfolio: ((arms: readonly ArmRef[]) => Promise<Portfolio>) | null
  /**
   * Words and icons for assets the portfolio has never seen — which is the
   * receiving side of every trade, by definition. Null costs those rows their
   * icon and nothing else.
   */
  tokens?: TokenRegistry | null
}

export function planRoutes(db: PlanDb, session: MiddlewareHandler, deps: PlanRouteDeps): Hono {
  const app = new Hono()
  app.use('*', session)
  const { webUrl } = deps

  /** The rows' icons, prices and wallet clients. An outage costs those, not the list. */
  const decorate = async (userId: string, rows: PlanSummary[]): Promise<DecoratedSummary[]> => {
    if (rows.length === 0) return []
    try {
      const arms = await listWallets(db as unknown as WalletDb, userId)
      const portfolio = deps.readPortfolio
        ? await deps.readPortfolio(arms.map((a) => ({ walletId: a.id, namespace: a.namespace, address: a.address })))
        : null
      return rows.map((row) => decorateSummary(row, arms, portfolio))
    } catch {
      return rows.map((row) => decorateSummary(row, [], null))
    }
  }

  /**
   * Icons and wallet clients for the page, looked up beside the plan and never
   * inside it. A provider outage costs the icons, not the review.
   */
  const visuals = async (userId: string, plan: Parameters<typeof visualsFor>[0]) => {
    try {
      const arms = await listWallets(db as unknown as WalletDb, userId)
      const portfolio = deps.readPortfolio
        ? await deps.readPortfolio(arms.map((a) => ({ walletId: a.id, namespace: a.namespace, address: a.address })))
        : null
      return visualsFor(plan, arms, portfolio, deps.tokens ?? null)
    } catch {
      return visualsFor(plan, [], null, deps.tokens ?? null)
    }
  }

  /**
   * The person's plans: every status, waiting-on-you first, then newest.
   * `?pending=1` is the subset the nav badge polls. Each row carries the
   * icon, the price and the wallet client beside it, looked up once per list
   * from the portfolio cache; none of that is on the plan.
   */
  app.get('/', async (c) => {
    const userId = c.get('userId')
    const records = c.req.query('pending') === '1' ? await listPending(db, userId) : await listPlans(db, userId)
    const rows = records.map(summarise)
    return c.json({ plans: await decorate(userId, rows), count: rows.length })
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
      statusDetail: record.statusDetail,
      link: { expiresAt: record.linkExpiresAt },
      visuals: await visuals(c.get('userId'), record.plan),
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
   * A fresh link to my own plan, for a list row. Tokens are stored hashed, so
   * the one the agent got cannot be read back; minting another is the honest
   * answer. Any status: a settled or refused plan opens to its ended state,
   * which is where the reasons are.
   */
  app.post('/:id/link', async (c) => {
    const id = c.req.param('id')
    if (!isUuid(id)) return c.json({ error: 'not_found' }, 404)
    const record = await findPlan(db, c.get('userId'), id)
    if (!record) return c.json({ error: 'not_found' }, 404)

    const link = await issueReviewLink(
      db,
      { planId: record.plan.id, version: record.plan.version, planExpiresAt: record.plan.expiresAt, status: record.plan.status },
      webUrl,
    )
    return c.json(link, 201)
  })

  return app
}
