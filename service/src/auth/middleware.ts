import type { MiddlewareHandler } from 'hono'
import { PrivyAuthError, bearerToken, type PrivyVerifier } from './privy.js'
import { userIdForDid, type UserDb } from './session.js'

/**
 * Module augmentation rather than a Hono generic on every app and sub-app.
 * Threading `Hono<SessionVars>` through app.ts would make the root app's type
 * depend on auth, and the two surfaces would stop being interchangeable in the
 * host router. These variables are set by requireSession and nothing else.
 */
declare module 'hono' {
  interface ContextVariableMap {
    /** Ottopus user id — the foreign key everything else hangs off. */
    userId: string
    /** The Privy DID behind it, for logs and for support questions. */
    privyDid: string
  }
}

export interface SessionOptions {
  verify: PrivyVerifier
  db: UserDb
}

/**
 * Requires a signed-in user, and resolves them to an Ottopus user id.
 *
 * Two things happen per request, and both have to: the token is verified, and
 * the DID is exchanged for a user id. Nothing downstream reads the token, so
 * there is no path where a route accidentally trusts an unverified claim.
 *
 * Errors are deliberately uniform. A caller learns that they are not signed in,
 * never why — "expired" and "not a real token" are the same 401, because the
 * difference is only useful to someone probing.
 */
export function requireSession({ verify, db }: SessionOptions): MiddlewareHandler {
  return async (c, next) => {
    const token = bearerToken(c.req.header('Authorization'))
    if (!token) {
      return c.json({ error: 'unauthorized' }, 401, { 'WWW-Authenticate': 'Bearer' })
    }

    let did: string
    try {
      ;({ did } = await verify(token))
    } catch (err) {
      if (err instanceof PrivyAuthError) {
        return c.json({ error: 'unauthorized' }, 401, { 'WWW-Authenticate': 'Bearer' })
      }
      throw err
    }

    c.set('userId', await userIdForDid(db, did))
    c.set('privyDid', did)
    await next()
  }
}
