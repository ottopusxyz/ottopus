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
    /** The service's own error code, when it sent one — `already_linked`, etc. */
    readonly code?: string | undefined,
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
    let code: string | undefined
    try {
      code = ((await response.json()) as { error?: string }).error
    } catch {
      // A 502 from a proxy is not JSON. The status is still the useful part.
    }
    throw new ApiError(response.status, `${init.method ?? 'GET'} ${path} failed`, code)
  }
  // 204 has no body, and response.json() on an empty one throws.
  if (response.status === 204) return undefined as T
  return (await response.json()) as T
}

/** One of Otto's eight arms. */
export interface Arm {
  id: string
  namespace: string
  address: string
  label: string | null
  /** metamask, rabby, safe, watch_only — what names the arm. */
  walletType: string
  /** No proof, so it can never sign. Pasted addresses and Safes. */
  isWatchOnly: boolean
  provedAt: string | null
  createdAt: string
}

export interface WalletSync {
  wallets: Arm[]
  /** Attested but over the eight-arm cap, so the app can say which. */
  overflow: string[]
}

export function listWallets(credentials: Credentials): Promise<{ wallets: Arm[] }> {
  return call('/wallets', credentials)
}

/**
 * Reconcile our arms against the wallets Privy attests in the identity token.
 *
 * This is what turns a Privy link into an Ottopus arm. Safe to call on every
 * cold boot: the service treats it as a snapshot and a call that changes
 * nothing costs one query.
 *
 * Requires an identity token. Without one the service answers 400 rather than
 * syncing an empty list, which would unlink every wallet.
 */
export function syncWallets(credentials: Credentials): Promise<WalletSync> {
  return call('/wallets/sync', credentials, { method: 'POST' })
}

/** A pasted address. Stored unproven, and it stays that way. */
export function addWatchOnlyWallet(
  credentials: Credentials,
  input: { address: string; label?: string; walletType?: 'watch_only' | 'safe' },
): Promise<{ wallet: Arm }> {
  return call('/wallets/watch', credentials, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
}

/**
 * Unlink on our side only. A wallet Privy still attests returns on the next
 * sync, so a proved wallet must be unlinked at Privy first — see the wallets
 * hook, which does both in order.
 */
export function unlinkWallet(credentials: Credentials, id: string): Promise<void> {
  return call(`/wallets/${id}`, credentials, { method: 'DELETE' })
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
