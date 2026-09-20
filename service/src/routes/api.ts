import { Hono, type Context } from 'hono'
import { cors } from 'hono/cors'
import { createPrivyAuth, keyProblem, requireSession } from '../auth/index.js'
import { config } from '../config.js'
import { getDb } from '../db/client.js'
import { readPortfolio } from '../connectors/portfolio/index.js'
import { zerionTokens } from '../connectors/tokens/index.js'
import { activityRoutes } from './activity.js'
import { agentRoutes } from './agents.js'
import { consentRoutes } from './consent.js'
import { apiErrorHandler } from './errors.js'
import { planRoutes } from './plans.js'
import { portfolioRoutes } from './portfolio.js'
import { activityProvider, portfolioProvider } from './portfolio-provider.js'
import { walletRoutes } from './wallets.js'

/**
 * Web-facing surface. Mounted at the root of api.ottopus.xyz in production,
 * and at /api everywhere.
 *
 * The browser holds no Supabase key, so this is the only path the web app has
 * to data. Authenticated by Privy session, unlike the MCP surface.
 */
export const apiApp = new Hono()

// Sub-apps mounted with route() share this: an error they let escape lands
// here, not in Hono's default, which answered with nothing the page or a log
// could use.
apiApp.onError(apiErrorHandler)

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
 * What the web app has to know about the service that it cannot work out.
 *
 * Only the MCP address so far, and it is here because the browser was deriving
 * it: the connect dialog took the API base and swapped /api for /mcp, which is
 * right on a laptop where both are paths on one origin and wrong in production
 * where they are separate subdomains. It handed out https://api.ottopus.xyz/mcp,
 * which answers 404 — a person pasted it into their agent and blamed the agent.
 *
 * The browser cannot derive this. mcpUrl is the issuer, and RFC 8707 compares
 * tokens against it as a string, so the address someone pastes has to be the
 * same string the service binds tokens to — not a second spelling of it that
 * happens to agree. Answering with config.mcpUrl makes them one value.
 *
 * Public, and deliberately so: the same string is already served unauthenticated
 * as `resource` in the protected-resource metadata, and it is a URL we want
 * people to copy.
 */
apiApp.get('/meta', (c) => c.json({ mcpUrl: config.mcpUrl }))

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

  /**
   * The browser-facing half of the OAuth grant flow. The agent-facing half
   * lives on the MCP surface with the issuer; this half is here because it
   * needs the Privy session and the browser CORS allow-list, like every other
   * route on this surface.
   */
  apiApp.route('/oauth/consent', consentRoutes(db, session))

  /** The agents holding a grant, and the control that ends one. */
  apiApp.route('/agents', agentRoutes(db, session))

  const provider = portfolioProvider

  /** Plans waiting on the person, the plan behind a review link, and the web's transitions. */
  apiApp.route(
    '/plans',
    planRoutes(db, session, {
      webUrl: config.webUrl,
      readPortfolio: provider ? (arms) => readPortfolio(provider, arms) : null,
      tokens: config.zerionApiKey
        ? zerionTokens({
            apiKey: config.zerionApiKey,
            ...(config.zerionApiUrl ? { baseUrl: config.zerionApiUrl } : {}),
          })
        : null,
    }),
  )

  /**
   * Balances are a separate readiness question from sign-in.
   *
   * A deployment with Privy wired up and no Zerion key should still let people
   * sign in and link wallets — only the numbers are missing. Folding this into
   * `missing` above would take the whole API down over a portfolio provider.
   */
  const noProvider = (c: Context) =>
    c.json({ error: 'not_configured', detail: ['ZERION_API_KEY is not set'] }, 503)
  if (portfolioProvider) {
    apiApp.route('/portfolio', portfolioRoutes(db, session, portfolioProvider))
  } else {
    apiApp.all('/portfolio', noProvider)
  }
  /** What the arms did on chain — the same provider, the same readiness question. */
  if (activityProvider) {
    apiApp.route('/activity', activityRoutes(db, session, activityProvider))
  } else {
    apiApp.all('/activity', noProvider)
  }
} else {
  const unconfigured = (c: Context) => c.json({ error: 'not_configured', detail: missing }, 503)
  apiApp.post('/session', unconfigured)
  apiApp.get('/me', unconfigured)
  apiApp.all('/wallets/*', unconfigured)
  apiApp.all('/wallets', unconfigured)
  apiApp.all('/plans/*', unconfigured)
  apiApp.all('/plans', unconfigured)
  apiApp.all('/portfolio', unconfigured)
  apiApp.all('/activity', unconfigured)
}
