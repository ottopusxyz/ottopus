import { randomUUID } from 'node:crypto'
import type { Context } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { PortfolioError } from '../connectors/portfolio/types.js'

/**
 * What an uncaught error becomes on the web surface.
 *
 * There was no handler, so anything a route let escape was Hono's bare
 * "Internal Server Error": no body the page could read, no line in the log
 * a person could find, and a provider outage indistinguishable from a bug.
 * During a Zerion incident that was every request that touched balances.
 *
 * Three answers. A Hono exception already knows its status. A provider that
 * would not answer is a 502, because the page has a state for exactly that
 * ("we could not reach balances") and keys it off the status; 503 is kept
 * for a provider that is not configured at all, which the page words
 * differently. Everything else is a 500 with a request id in the body and
 * the same id on the log line with the stack — so "I got a 500" can be
 * turned into a stack in one grep.
 */
export function apiErrorHandler(err: Error, c: Context): Response {
  if (err instanceof HTTPException) return err.getResponse()
  if (err instanceof PortfolioError) {
    return c.json({ error: 'provider_unavailable', code: err.code }, err.code === 'not_configured' ? 503 : 502)
  }
  const requestId = randomUUID()
  console.error(
    JSON.stringify({
      level: 'error',
      msg: 'unhandled',
      requestId,
      method: c.req.method,
      path: c.req.path,
      err: String(err),
      stack: err.stack,
    }),
  )
  return c.json({ error: 'internal', requestId }, 500)
}
