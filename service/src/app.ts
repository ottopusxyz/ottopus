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

/** Leftmost label of the request host, e.g. "mcp" for mcp.ottopus.xyz. */
function subdomain(req: Request): string {
  try {
    return new URL(req.url).hostname.split('.')[0] ?? ''
  } catch {
    return ''
  }
}

/**
 * Dispatch on hostname first, falling through to path-based routing. Railway's
 * own health check hits the internal domain, which matches neither subdomain —
 * so the root app must always answer /health.
 */
export function handler(req: Request): Response | Promise<Response> {
  switch (subdomain(req)) {
    case 'mcp':
      return mcpApp.fetch(req)
    case 'api':
      return apiApp.fetch(req)
    default:
      return rootApp.fetch(req)
  }
}
