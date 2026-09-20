import { Hono, type MiddlewareHandler } from 'hono'
import { z } from 'zod'
import type { WalletDb } from '../wallets/index.js'
import {
  WalletError,
  addWatchOnlyWallet,
  listWallets,
  syncWallets,
  unlinkWallet,
  updateWallet,
  WALLET_TYPES,
} from '../wallets/index.js'

/**
 * The arms.
 *
 * Ownership is proved through Privy's link flow, which runs EIP-4361 against
 * our own origin and verifies the signature server-side. Nothing here trusts a
 * request body for an address: the wallet list arrives on the verified identity
 * token, which the session middleware has already checked belongs to the caller.
 *
 * The single exception is the watch-only route, and it is honest about it — a
 * pasted address is stored as unproven and can never sign.
 */

const watchOnlySchema = z.object({
  address: z.string(),
  label: z.string().max(60).optional(),
  walletType: z.enum(['watch_only', 'safe']).optional(),
})

const STATUS: Record<WalletError['code'], 400 | 404 | 409 | 422> = {
  invalid_address: 400,
  invalid_type: 400,
  already_linked: 409,
  too_many_wallets: 422,
  not_found: 404,
}

const editSchema = z
  .object({
    label: z.string().max(60).nullable().optional(),
    walletType: z.enum(WALLET_TYPES as [string, ...string[]]).optional(),
  })
  .refine((v) => v.label !== undefined || v.walletType !== undefined, { message: 'nothing to change' })

export function walletRoutes(db: WalletDb, session: MiddlewareHandler): Hono {
  const app = new Hono()
  app.use('*', session)

  const fail = (err: unknown) => {
    if (err instanceof WalletError) return { code: err.code, status: STATUS[err.code] } as const
    throw err
  }

  app.get('/', async (c) => c.json({ wallets: await listWallets(db, c.get('userId')) }))

  /**
   * Reconcile against the identity token.
   *
   * A missing identity token is a 400, not an empty sync. The header is
   * optional everywhere else in this service — the access token alone says who
   * you are — but here its absence would look exactly like "Privy attests no
   * wallets", and acting on that would unlink every arm the person has.
   */
  app.post('/sync', async (c) => {
    const attested = c.get('privyWallets')
    if (!attested) {
      return c.json(
        {
          error: 'identity_token_required',
          detail:
            'Send X-Privy-Identity-Token. Enable identity tokens in the Privy dashboard under ' +
            'User management > Authentication > Advanced.',
        },
        400,
      )
    }

    const { wallets, overflow } = await syncWallets(db, c.get('userId'), attested)
    return c.json({ wallets, overflow })
  })

  /** A pasted address. Watch-only, permanently — see the schema trigger. */
  app.post('/watch', async (c) => {
    const body = watchOnlySchema.safeParse(await c.req.json().catch(() => null))
    if (!body.success) return c.json({ error: 'invalid_request' }, 400)

    try {
      return c.json({ wallet: await addWatchOnlyWallet(db, c.get('userId'), body.data) }, 201)
    } catch (err) {
      const { code, status } = fail(err)
      return c.json({ error: code }, status)
    }
  })

  /** The name and the kind. The address and the proof are not for editing. */
  app.patch('/:id', async (c) => {
    const id = c.req.param('id')
    if (!z.uuid().safeParse(id).success) return c.json({ error: 'not_found' }, 404)
    const parsed = editSchema.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return c.json({ error: 'invalid_type', detail: parsed.error.issues.map((i) => i.message) }, 400)
    try {
      return c.json({ wallet: await updateWallet(db, c.get('userId'), id, parsed.data) })
    } catch (err) {
      const { code, status } = fail(err)
      return c.json({ error: code }, status)
    }
  })

  /**
   * Unlink here, and at Privy from the browser. This alone is not enough for a
   * proved wallet — the next sync would attest it and bring it straight back —
   * so the web app calls Privy's unlink first. Watch-only arms have no Privy
   * side, so for them this is the whole operation.
   */
  app.delete('/:id', async (c) => {
    const id = c.req.param('id')
    // Postgres raises on a malformed uuid, which would surface as a 500 for
    // what is plainly a bad request. Same answer as an id that does not exist.
    if (!z.uuid().safeParse(id).success) return c.json({ error: 'not_found' }, 404)

    try {
      await unlinkWallet(db, c.get('userId'), id)
      return c.body(null, 204)
    } catch (err) {
      const { code, status } = fail(err)
      return c.json({ error: code }, status)
    }
  })

  return app
}
