import { Hono, type MiddlewareHandler } from 'hono'
import { z } from 'zod'
import {
  ACTIVITY_KINDS,
  decodeCursor,
  readActivity,
  type ActivityConnector,
  type ActivityKind,
} from '../connectors/activity/index.js'
import type { ArmRef } from '../connectors/portfolio/index.js'
import { listWallets, type WalletDb } from '../wallets/index.js'

const DEFAULT_SIZE = 25
const MAX_SIZE = 50

const KIND = z.enum(ACTIVITY_KINDS as [ActivityKind, ...ActivityKind[]])

const query = z.object({
  /** One linked wallet's id, or every wallet. */
  wallet: z.string().uuid().optional(),
  /** CAIP-2. */
  chain: z.string().regex(/^eip155:\d+$/).optional(),
  /** Comma-separated kinds. */
  kinds: z
    .string()
    .transform((raw) => raw.split(',').filter(Boolean))
    .pipe(z.array(KIND).max(ACTIVITY_KINDS.length))
    .optional(),
  /** Eight arms, each a bound and at most MAX_SEEN ids, fits well inside this. */
  cursor: z
    .string()
    .max(12_000)
    .refine((raw) => decodeCursor(raw) !== null, 'cursor is not one this service wrote')
    .optional(),
  size: z.coerce.number().int().min(1).max(MAX_SIZE).default(DEFAULT_SIZE),
})

/**
 * What the activity page reads: every arm's on-chain history, merged.
 *
 * The filters go to the provider rather than being applied to a page after
 * the fact, so a page filtered to trades is a page of trades and not the
 * three that happened to be on it. Watch-only arms are read like any other:
 * what an address did is the entire reason someone pastes one.
 */
export function activityRoutes(db: WalletDb, session: MiddlewareHandler, connector: ActivityConnector): Hono {
  const app = new Hono()
  app.use('*', session)

  app.get('/', async (c) => {
    const parsed = query.safeParse(c.req.query())
    if (!parsed.success) {
      return c.json({ error: 'bad_request', detail: parsed.error.issues.map((i) => i.message) }, 400)
    }
    const { wallet, chain, kinds, cursor, size } = parsed.data

    const wallets = await listWallets(db, c.get('userId'))
    const arms: ArmRef[] = wallets
      .filter((w) => !wallet || w.id === wallet)
      .map((w) => ({ walletId: w.id, namespace: w.namespace, address: w.address }))

    // A wallet id that is not one of this person's arms reads as no arms — a
    // 404 would confirm the id exists for someone.
    const feed = await readActivity(connector, arms, { kinds, chainId: chain, cursor, size })
    return c.json(feed)
  })

  return app
}
