import { Hono, type MiddlewareHandler } from 'hono'
import type { Db } from '../db/client.js'
import {
  NEVER_GRANTED,
  SCOPE_COPY,
  decideAuthRequest,
  findAuthRequest,
  findClient,
  mintAuthCode,
  resourceUrl,
} from '../oauth/index.js'

/**
 * What the consent page reads, and what it posts back.
 *
 * On the API surface rather than the MCP one, because this half of OAuth is the
 * web app talking about a person: it needs the Privy session, the browser CORS
 * allow-list and the same 401 shape as every other page. The agent-facing half
 * — authorize, token, register — stays on the MCP surface with the issuer.
 *
 * The page is handed a request id and nothing else. Everything it displays is
 * read back from here, so what a person approves is what was stored when the
 * agent asked, not what a query string claimed on the way through the browser.
 */
export function consentRoutes(db: Db, session: MiddlewareHandler): Hono {
  const app = new Hono()
  app.use('*', session)

  /**
   * The grant, as a person should see it.
   *
   * The scope copy is served rather than duplicated in the web app: the words
   * describing a permission and the permission itself have to change together,
   * and a second copy in another package is how they stop agreeing.
   */
  app.get('/:id', async (c) => {
    const request = await findAuthRequest(db, c.req.param('id'))
    if (!request) return c.json({ error: 'not_found' }, 404)

    if (request.decidedAt) return c.json({ error: 'already_decided' }, 409)
    if (request.expiresAt.getTime() <= Date.now()) return c.json({ error: 'expired' }, 410)

    const client = await findClient(db, request.clientId)
    if (!client) return c.json({ error: 'not_found' }, 404)

    return c.json({
      request: {
        id: request.id,
        expiresAt: request.expiresAt.toISOString(),
      },
      client: {
        name: client.clientName,
        uri: client.clientUri,
        // The host, not the whole URI. It is what a person can actually check,
        // and the full callback is a long opaque string that reads as noise.
        redirectHost: hostOf(request.redirectUri),
      },
      resource: resourceUrl(),
      // Only the scopes this request actually asked for, in the design's order.
      granted: SCOPE_COPY.filter((entry) => request.scopes.includes(entry.scope)),
      neverGranted: NEVER_GRANTED,
    })
  })

  /**
   * The answer.
   *
   * Approve and deny take the same path deliberately: a denial has to reach the
   * agent's callback too, or the agent sits waiting on a flow the person
   * already ended. Both end in a redirect URL for the browser to follow.
   */
  app.post('/:id', async (c) => {
    const body = await c.req.json().catch(() => null)
    const approved = (body as { approved?: unknown } | null)?.approved === true

    const decided = await decideAuthRequest(db, {
      id: c.req.param('id'),
      userId: c.get('userId'),
      approved,
    })
    // Null means it was already answered, or it expired while the page was
    // open. Both are the same to the caller: this request is over.
    if (!decided) return c.json({ error: 'not_pending' }, 409)

    const redirect = new URL(decided.redirectUri)
    redirect.searchParams.set('iss', resourceUrl())
    if (decided.state) redirect.searchParams.set('state', decided.state)

    if (!approved) {
      redirect.searchParams.set('error', 'access_denied')
      redirect.searchParams.set('error_description', 'The account holder denied this request.')
      return c.json({ redirectTo: redirect.toString() })
    }

    redirect.searchParams.set('code', await mintAuthCode(db, decided))
    return c.json({ redirectTo: redirect.toString() })
  })

  return app
}

/** The callback's host, for the "you will be returned to" line. */
function hostOf(uri: string): string {
  try {
    return new URL(uri).host
  } catch {
    return uri
  }
}
