import { Hono } from 'hono'
import { config } from '../config.js'
import { getDb } from '../db/client.js'
import { handleMcpRequest } from '../mcp/transport.js'
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
   * The MCP endpoint itself. One handler for every method the transport uses —
   * POST carries requests, GET opens a stream, DELETE ends a session — because
   * the transport decides what each means, not us.
   */
  mcpApp.on(['POST', 'GET', 'DELETE'], '/', requireGrant(db), (c) =>
    handleMcpRequest(c, {
      userId: c.get('userId'),
      clientId: c.get('grantClientId'),
      scopes: c.get('grantScopes'),
    }),
  )

  /** An unauthenticated probe should still learn where to authenticate. */
  mcpApp.notFound((c) =>
    c.json({ error: 'not_found' }, 404, { 'WWW-Authenticate': challenge() }),
  )
}
