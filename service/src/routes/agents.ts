import { Hono, type MiddlewareHandler } from 'hono'
import type { Db } from '../db/client.js'
import { SCOPE_COPY, listGrants, revokeGrant } from '../oauth/index.js'

/**
 * The agents a person has authorised, and the control to end one.
 *
 * Grants rather than tokens, because a token is the wrong unit for both halves
 * of this screen: they rotate hourly, so "connected since" would drift, and
 * revoking would have to chase every row instead of setting one flag.
 *
 * A revoked grant stays in the list. Losing it silently would make revocation
 * feel like it might not have worked, on the one screen where that doubt is
 * least acceptable.
 */
export function agentRoutes(db: Db, session: MiddlewareHandler): Hono {
  const app = new Hono()
  app.use('*', session)

  app.get('/', async (c) => {
    const grants = await listGrants(db, c.get('userId'))
    return c.json({
      agents: grants.map((grant) => ({
        id: grant.id,
        name: grant.clientName,
        uri: grant.clientUri,
        // The callbacks it registered. Not secret — they are the agent's own,
        // and the person approving the grant already saw one on the consent
        // screen. They are also the only thing we know about an agent that the
        // agent did not simply assert.
        redirectUris: grant.redirectUris,
        grantedAt: grant.grantedAt.toISOString(),
        lastUsedAt: grant.lastUsedAt?.toISOString() ?? null,
        revokedAt: grant.revokedAt?.toISOString() ?? null,
        // The same wording as the consent screen. A person should recognise
        // what they approved, and two sets of words for one permission is how
        // a grant screen and a settings screen start describing different
        // products.
        scopes: SCOPE_COPY.filter((entry) => grant.scopes.includes(entry.scope)),
      })),
    })
  })

  /**
   * DELETE, because from the caller's side this ends the grant. The row
   * survives — that is our bookkeeping, not their mental model.
   */
  app.delete('/:id', async (c) => {
    const revoked = await revokeGrant(db, c.get('userId'), c.req.param('id'))
    // 404 rather than 204 when nothing was live: a caller who revokes twice
    // should be able to tell that the second call did nothing, and an id that
    // belongs to someone else must not read as a success.
    if (!revoked) return c.json({ error: 'not_found' }, 404)
    return c.body(null, 204)
  })

  return app
}
