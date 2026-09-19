import { Hono } from 'hono'
import { config } from '../config.js'
import { getDb } from '../db/client.js'
import { findUserById } from '../auth/session.js'
import { createPlan, findPlan, issueReviewLink, recordSimulation, transition } from '../plans/index.js'
import { httpLookups } from '../verify/index.js'
import { readPortfolio } from '../connectors/portfolio/index.js'
import type { ToolDeps } from '../mcp/server.js'
import { handleMcpRequest } from '../mcp/transport.js'
import { findClient } from '../oauth/store.js'
import { listWallets } from '../wallets/index.js'
import { baselineSimulator, composite } from '../connectors/simulation/index.js'
import { portfolioProvider } from './portfolio-provider.js'
import {
  authorizationServerMetadata,
  challenge,
  oauthRoutes,
  protectedResourceMetadata,
  requireGrant,
  wellKnownPaths,
} from '../oauth/index.js'

/**
 * Agent-facing surface. Mounted at the root of mcp.ottopus.xyz in production,
 * and at /mcp everywhere — local development has no subdomains.
 *
 * The OAuth authorize and token endpoints belong here too, so the issuer origin
 * matches the MCP endpoint and discovery needs no special casing.
 */
export const mcpApp = new Hono()

mcpApp.get('/health', (c) => c.json({ ok: true, surface: 'mcp' }))

/**
 * Discovery, served from the resource's own origin.
 *
 * Both well-known paths are anchored to the origin, not to wherever the surface
 * happens to be mounted, and RFC 8414 and RFC 9728 both insert the resource's
 * path after the well-known segment. So on mcp.ottopus.xyz the documents live at
 * /.well-known/oauth-authorization-server, while at localhost:8787/mcp they live
 * at /.well-known/oauth-authorization-server/mcp — and this app is mounted on
 * both the root app and the MCP app so every spelling resolves.
 *
 * Getting this wrong is not a subtle failure. A client that cannot find the
 * authorization server document never learns the registration endpoint, falls
 * back to guessing one off the issuer, and reports a 404 from dynamic client
 * registration — which says nothing about the real problem.
 */
export const wellKnownApp = new Hono()

for (const path of wellKnownPaths().protectedResource) {
  wellKnownApp.get(path, (c) => c.json(protectedResourceMetadata()))
}

for (const path of wellKnownPaths().authorizationServer) {
  wellKnownApp.get(path, (c) => c.json(authorizationServerMetadata()))
}

mcpApp.route('/', wellKnownApp)

/**
 * Without a database there is no grant to check and no user to act for, so the
 * surface says so rather than answering 401 to every request. "Not configured"
 * and "not authorized" are different problems and must not look alike.
 */
if (!config.databaseUrl) {
  console.error('[mcp] agent surface disabled — DATABASE_URL is not set')
  mcpApp.all('*', (c) => c.json({ error: 'service_unconfigured' }, 503))
} else {
  const db = getDb(config.databaseUrl)

  mcpApp.route('/oauth', oauthRoutes(db))

  /**
   * What the tools may read, bound to this database and this deployment's
   * balance provider. The same functions the web surface's routes call —
   * two adapters over one core, and neither with logic of its own.
   */
  const provider = portfolioProvider
  const deps: ToolDeps = {
    findUser: (userId) => findUserById(db, userId),
    findAgent: (clientId) => findClient(db, clientId),
    listWallets: (userId) => listWallets(db, userId),
    readPortfolio: provider ? (arms) => readPortfolio(provider, arms) : null,
    lookups: httpLookups({ rpcUrlTemplate: config.rpcUrlTemplate }),
    simulator: composite([baselineSimulator({ rpcUrlTemplate: config.rpcUrlTemplate })]),
    createPlan: (input) => createPlan(db, input),
    issueReviewLink: (planId, version, planExpiresAt) =>
      issueReviewLink(db, { planId, version, planExpiresAt }, config.webUrl),
    recordSimulation: (input) => recordSimulation(db, input),
    findPlan: (userId, planId) => findPlan(db, userId, planId),
    transition: (input) => transition(db, input),
  }

  /**
   * The MCP endpoint itself. One handler for every method the transport uses —
   * POST carries requests, GET opens a stream, DELETE ends a session — because
   * the transport decides what each means, not us.
   */
  mcpApp.on(['POST', 'GET', 'DELETE'], '/', requireGrant(db), (c) =>
    handleMcpRequest(
      c,
      {
        userId: c.get('userId'),
        clientId: c.get('grantClientId'),
        scopes: c.get('grantScopes'),
        grantId: c.get('grantId'),
      },
      deps,
    ),
  )

  /** An unauthenticated probe should still learn where to authenticate. */
  mcpApp.notFound((c) =>
    c.json({ error: 'not_found' }, 404, { 'WWW-Authenticate': challenge() }),
  )
}
