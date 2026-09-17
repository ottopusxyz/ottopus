import { Hono } from 'hono'
import { config } from '../config.js'
import { getDb } from '../db/client.js'
import { handleMcpRequest } from '../mcp/transport.js'
import {
  challenge,
  oauthRoutes,
  protectedResourceMetadata,
  requireGrant,
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
 * RFC 9728, served from the resource's own origin.
 *
 * Also mounted on the root app, because the well-known path is anchored to the
 * origin and the resource may carry a path: on mcp.ottopus.xyz the document
 * belongs at /.well-known/oauth-protected-resource, while at localhost:8787/mcp
 * it belongs at /.well-known/oauth-protected-resource/mcp. Both forms answer, so
 * a client that constructs the path itself and one that follows the URL we hand
 * it in the 401 both arrive.
 */
export const wellKnownApp = new Hono()
wellKnownApp.get('/.well-known/oauth-protected-resource', (c) =>
  c.json(protectedResourceMetadata()),
)
wellKnownApp.get('/.well-known/oauth-protected-resource/mcp', (c) =>
  c.json(protectedResourceMetadata()),
)

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
   * Also served here for clients that append the well-known path to the full
   * authorization server URL rather than inserting it at the origin. Both
   * spellings are in the wild; answering both costs one route.
   */
  mcpApp.get('/.well-known/oauth-authorization-server', (c) =>
    c.redirect('/oauth/.well-known/oauth-authorization-server', 302),
  )

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
