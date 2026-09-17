/**
 * The only path from the browser to Ottopus's data.
 *
 * Every call carries the Privy access token as a bearer credential, and the
 * service verifies it per request — nothing here is trusted because it came
 * from our own code. The identity token rides along in its own header when we
 * have one: it is what tells the service what a person is called, signed by
 * Privy so the name in our database is attested rather than typed.
 */

const BASE = (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8787/api').replace(/\/$/, '')

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

export interface SessionUser {
  id: string
  privyDid: string
  email: string | null
  name: string | null
}

export interface Credentials {
  accessToken: string
  /** Absent until Privy has one; the call still works without it. */
  identityToken?: string | null
}

async function call<T>(path: string, credentials: Credentials, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers)
  headers.set('Authorization', `Bearer ${credentials.accessToken}`)
  if (credentials.identityToken) {
    headers.set('X-Privy-Identity-Token', credentials.identityToken)
  }

  const response = await fetch(`${BASE}${path}`, { ...init, headers })
  if (!response.ok) {
    // The service answers 503 when it is not configured and 401 when the token
    // is no good. Keeping the status lets a caller tell those apart, which
    // matters because only one of them is the person's problem.
    throw new ApiError(response.status, `${init.method ?? 'GET'} ${path} failed`)
  }
  return (await response.json()) as T
}

/**
 * Establish the session: exchange a Privy token for an Ottopus user, creating
 * the row on a first ever sign-in. Idempotent, so calling it again on every
 * cold boot is the intended use rather than a waste.
 */
export function establishSession(credentials: Credentials): Promise<{ user: SessionUser }> {
  return call('/session', credentials, { method: 'POST' })
}

export const API_BASE = BASE
