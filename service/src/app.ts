import { Hono } from 'hono'
import { config } from './config.js'
import { apiApp } from './routes/api.js'
import { mcpApp } from './routes/mcp.js'

/**
 * One process, two surfaces, one core underneath.
 *
 * In production each surface gets its own hostname — mcp.ottopus.xyz and
 * api.ottopus.xyz — both pointing at this same service. Locally there are no
 * subdomains, so the same surfaces are also mounted at /mcp and /api. Both
 * forms stay valid in both places, which keeps a URL copied from a log or a
 * doc working wherever it is pasted.
 */
export const rootApp = new Hono()

rootApp.get('/health', (c) =>
  c.json({
    ok: true,
    service: 'ottopus',
    env: config.nodeEnv,
    commit: config.gitCommit,
  }),
)

rootApp.route('/mcp', mcpApp)
rootApp.route('/api', apiApp)

/**
 * Leftmost label of the request host, e.g. "mcp" for mcp.ottopus.xyz.
 *
 * Reads the Host header rather than parsing req.url — this runs on every
 * request, and it avoids allocating a URL object per request.
 *
 * Any proxy in front must preserve the Host header. If one rewrites it, this
 * returns something unrecognised and the request falls through to path-based
 * routing, which still works — the surfaces degrade rather than disappear.
 */
function subdomain(req: Request): string {
  const host = req.headers.get('host')
  if (!host) return ''
  const end = host.indexOf('.')
  const label = end < 0 ? host : host.slice(0, end)
  // Strip a port when the host has no dots, e.g. "localhost:8787".
  const colon = label.indexOf(':')
  return (colon < 0 ? label : label.slice(0, colon)).toLowerCase()
}

/**
 * On a surface's own hostname the surface answers at the root, and also under
 * its path prefix. Both forms resolve everywhere, so a URL copied from local
 * development still works when pasted against the deployed host — which matters
 * most for the MCP URL, the one address people copy by hand.
 */
function hostApp(surface: Hono, prefix: string): Hono {
  const app = new Hono()
  app.route('/', surface)
  app.route(prefix, surface)
  return app
}

const mcpHost = hostApp(mcpApp, '/mcp')
const apiHost = hostApp(apiApp, '/api')

/**
 * Dispatch on hostname first, falling through to path-based routing. Railway's
 * own health check hits the internal domain, which matches neither subdomain —
 * so the root app must always answer /health.
 */
export function handler(req: Request): Response | Promise<Response> {
  switch (subdomain(req)) {
    case 'mcp':
      return mcpHost.fetch(req)
    case 'api':
      return apiHost.fetch(req)
    default:
      return rootApp.fetch(req)
  }
}
