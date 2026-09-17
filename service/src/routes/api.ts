import { Hono, type Context } from 'hono'
import { cors } from 'hono/cors'
import { createPrivyAuth, keyProblem, requireSession } from '../auth/index.js'
import { config } from '../config.js'
import { getDb } from '../db/client.js'
import { walletRoutes } from './wallets.js'

/**
 * Web-facing surface. Mounted at the root of api.ottopus.xyz in production,
 * and at /api everywhere.
 *
 * The browser holds no Supabase key, so this is the only path the web app has
 * to data. Authenticated by Privy session, unlike the MCP surface.
 */
export const apiApp = new Hono()

/**
 * The web app is always cross-origin — ottopus.xyz calling api.ottopus.xyz in
 * production, :3000 calling :8787 locally — so every call from the browser is
 * preflighted and dies without this.
 *
 * An allow-list rather than `*`. Bearer tokens make `*` survivable, but the
 * list costs nothing and means a stray site cannot quietly read responses on
 * behalf of someone already signed in.
 *
 * X-Privy-Identity-Token has to be named explicitly: a custom request header is
 * exactly what turns a simple request into a preflighted one, and a browser
 * will not send a header the preflight did not allow.
 */
apiApp.use(
  '*',
  cors({
    origin: (origin) => (config.webOrigins.includes(origin) ? origin : null),
    allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Authorization', 'Content-Type', 'X-Privy-Identity-Token'],
    // A day of not re-asking. The answer only changes on deploy.
    maxAge: 86400,
  }),
)

apiApp.get('/health', (c) => c.json({ ok: true, surface: 'api' }))

/**
 * Sign-in needs three values wired up. Without them the authenticated routes
 * answer 503 rather than 401: "not configured" and "not signed in" are
 * different problems, and returning 401 here would send someone to fix their
 * session when the deployment is what is missing.
 *
 * The key is checked for shape, not just presence — a truncated PEM is present
 * and useless, and it would otherwise fail as a 401 on every request.
 */
const missing: string[] = []
if (!config.privyAppId) missing.push('PRIVY_APP_ID is not set')
if (!config.databaseUrl) missing.push('DATABASE_URL is not set')
const keyIssue = keyProblem(config.privyVerificationKey)
if (keyIssue) missing.push(`PRIVY_JWT_VERIFICATION_KEY ${keyIssue}`)

const ready = missing.length === 0
if (!ready) console.error(`[api] sign-in disabled — ${missing.join('; ')}`)

if (ready) {
  const db = getDb(config.databaseUrl!)
  const session = requireSession({
    auth: createPrivyAuth({
      appId: config.privyAppId!,
      verificationKey: config.privyVerificationKey!,
    }),
    db,
  })

  /**
   * Establish the session. The web app calls this once after signing in, and
   * this is what creates the user row on a first ever sign-in — there is no
   * separate registration step.
   *
   * POST rather than GET because it writes. An idempotent write is still a
   * write, and a GET that creates rows is one link prefetcher away from
   * creating them by accident.
   */
  apiApp.post('/session', session, (c) => c.json({ user: c.get('user') }))

  /** Who the caller is, without writing anything new. */
  apiApp.get('/me', session, (c) => c.json({ user: c.get('user') }))

  apiApp.route('/wallets', walletRoutes(db, session))
} else {
  const unconfigured = (c: Context) => c.json({ error: 'not_configured', detail: missing }, 503)
  apiApp.post('/session', unconfigured)
  apiApp.get('/me', unconfigured)
  apiApp.all('/wallets/*', unconfigured)
  apiApp.all('/wallets', unconfigured)
}
