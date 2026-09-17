import type { MiddlewareHandler } from 'hono'
import { PrivyAuthError, bearerToken, type PrivyAuth } from './privy.js'
import { upsertUser, type UserDb } from './session.js'

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
    /** The stored user — what we know, not what the caller claims. */
    user: { id: string; privyDid: string; email: string | null; name: string | null }
  }
}

export interface SessionOptions {
  auth: PrivyAuth
  db: UserDb
}

/**
 * Privy's identity token, when the caller sends one. Optional by design: the
 * access token alone is enough to know who you are, and the identity token
 * only adds what you are called.
 */
const IDENTITY_HEADER = 'X-Privy-Identity-Token'

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
export function requireSession({ auth, db }: SessionOptions): MiddlewareHandler {
  return async (c, next) => {
    const token = bearerToken(c.req.header('Authorization'))
    if (!token) {
      return c.json({ error: 'unauthorized' }, 401, { 'WWW-Authenticate': 'Bearer' })
    }

    let did: string
    try {
      ;({ did } = await auth.verifyAccess(token))
    } catch (err) {
      if (err instanceof PrivyAuthError) {
        return c.json({ error: 'unauthorized' }, 401, { 'WWW-Authenticate': 'Bearer' })
      }
      throw err
    }

    // A bad identity token is not a failed sign-in — the access token already
    // proved who this is. It only means we learn no name this time.
    let profile = {}
    const identity = c.req.header(IDENTITY_HEADER)
    if (identity) {
      try {
        const read = await auth.readIdentity(identity)
        if (read.did === did) profile = { email: read.email, name: read.name }
      } catch {
        // Ignored on purpose. See above.
      }
    }

    const user = await upsertUser(db, did, profile)
    c.set('userId', user.id)
    c.set('privyDid', did)
    c.set('user', user)
    await next()
  }
}
