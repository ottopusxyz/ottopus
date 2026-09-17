import type { MiddlewareHandler } from 'hono'
import { bearerToken } from '../auth/privy.js'
import type { Db } from '../db/client.js'
import { challenge, resourceUrl } from './metadata.js'
import { hasScope, type Scope } from './scopes.js'
import { findToken } from './store.js'

/**
 * The resource-server half: what an MCP request has to prove before it reaches
 * a tool.
 *
 * Separate from requireSession, which authenticates a person through Privy.
 * This authenticates an agent through a grant that person approved. Both end at
 * the same place — a userId on the context — and that is the point: the two
 * surfaces are adapters over one core, so a plan built by an agent and one
 * built from the web are the same plan.
 */

declare module 'hono' {
  interface ContextVariableMap {
    /** The scopes this grant actually carries. */
    grantScopes: Scope[]
    /** The agent's client id, for logs and for revocation in Settings. */
    grantClientId: string
  }
}

/**
 * Requires a live access token issued by us, for us.
 *
 * The audience check is not ceremony. The MCP spec is explicit that a resource
 * server must reject a token that was not issued for it, because the alternative
 * is a confused deputy: an agent holding a token for some other service could
 * otherwise spend it here.
 */
export function requireGrant(db: Db): MiddlewareHandler {
  return async (c, next) => {
    const token = bearerToken(c.req.header('Authorization'))
    if (!token) {
      return c.json({ error: 'unauthorized' }, 401, { 'WWW-Authenticate': challenge() })
    }

    const grant = await findToken(db, token, 'access')
    if (!grant) {
      return c.json({ error: 'invalid_token' }, 401, {
        'WWW-Authenticate': challenge(undefined, 'invalid_token'),
      })
    }
    // A token with no recorded audience predates audience binding; one naming
    // somebody else was never ours to accept.
    if (grant.resource && grant.resource !== resourceUrl()) {
      return c.json({ error: 'invalid_token' }, 401, {
        'WWW-Authenticate': challenge(undefined, 'invalid_token'),
      })
    }

    c.set('userId', grant.userId)
    c.set('grantScopes', grant.scopes)
    c.set('grantClientId', grant.clientId)
    await next()
  }
}

/**
 * Requires one scope on top of a valid grant.
 *
 * 403 with `insufficient_scope`, not 401: the token is fine, the grant is too
 * narrow. A client that reads the difference knows to ask for more rather than
 * to sign in again, and the spec asks us to name every scope the operation
 * needs in one challenge rather than one at a time.
 */
export function requireScope(scope: Scope): MiddlewareHandler {
  return async (c, next) => {
    if (!hasScope(c.get('grantScopes') ?? [], scope)) {
      return c.json({ error: 'insufficient_scope', scope }, 403, {
        'WWW-Authenticate': challenge([scope], 'insufficient_scope'),
      })
    }
    await next()
  }
}
