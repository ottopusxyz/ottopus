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
 * How an asset is held. `wallet` is the only one a plan can spend — a staked
 * balance is real money and not money you can send today.
 */
export type PositionType =
  | 'wallet'
  | 'deposit'
  | 'loan'
  | 'locked'
  | 'staked'
  | 'reward'
  | 'investment'

/** Why an arm's balances are missing. `ok` means they are not. */
export type ArmStatus = 'ok' | 'untracked_address' | 'rate_limited' | 'unavailable' | 'not_configured'

export interface ArmSummary {
  walletId: string
  address: string
  status: ArmStatus
  total: number
  change1d: number
  positionCount: number
}

/** One arm's share of an asset row. */
export interface Holding {
  walletId: string
  positionType: PositionType
  /** Base units. */
  amount: string
  value: number | null
  protocol: string | null
  groupId: string | null
}

export interface AssetInfo {
  /** Provider-scoped identity shared by deployments of the same token across chains. */
  familyId?: string | null
  symbol: string
  name: string
  decimals: number
  iconUrl: string | null
  verified: boolean
}

export interface AssetRow {
  /** CAIP-19 — one asset, on one chain, across every arm. */
  assetId: string
  chainId: string
  asset: AssetInfo
  /** Base units, summed across arms. Never a number. */
  amount: string
  /** Base units held loosely — what a plan could actually spend. */
  spendable: string
  /** Signed: a row that is only debt is negative. */
  value: number
  price: number | null
  change1d: number
  /** Fraction of gross holdings, 0..1. */
  share: number
  holdings: Holding[]
}

export interface ChainRow {
  iconUrl?: string | null
  chainId: string
  name: string
  value: number
  share: number
}

export interface Portfolio {
  provider: string
  currency: string
  asOf: string
  /** Signed sum across every arm that could be read. Debt reduces it. */
  total: number
  /** Sum of positive values — the denominator behind every `share`. */
  gross: number
  change1d: number
  arms: ArmSummary[]
  chains: ChainRow[]
  assets: AssetRow[]
}

/**
 * Balances for every linked arm, aggregated with the per-arm breakdown kept.
 *
 * The service reads them; the browser never holds a portfolio provider's key.
 * An arm the provider could not read comes back in `arms` with a reason rather
 * than being dropped, so the page can say six of eight were read instead of
 * quietly showing a smaller total.
 */
export function getPortfolio(credentials: Credentials): Promise<Portfolio> {
  return call('/portfolio', credentials)
}

/**
 * Establish the session: exchange a Privy token for an Ottopus user, creating
 * the row on a first ever sign-in. Idempotent, so calling it again on every
 * cold boot is the intended use rather than a waste.
 */
/**
 * A grant an agent is asking for, as the consent page shows it.
 *
 * The wording of each permission comes from the service rather than living
 * here: the words describing a scope and the scope itself have to change
 * together, and a second copy in this package is how they stop agreeing.
 */
export interface ConsentGrant {
  request: { id: string; expiresAt: string }
  client: { name: string; uri: string | null; redirectHost: string }
  resource: string
  granted: { scope: string; title: string; detail: string }[]
  neverGranted: { title: string; detail: string }
}

export function readConsent(credentials: Credentials, id: string): Promise<ConsentGrant> {
  return call<ConsentGrant>(`/oauth/consent/${encodeURIComponent(id)}`, credentials)
}

/**
 * Answer it. Both answers return somewhere to go — a denial has to reach the
 * agent's callback too, or the agent waits on a flow that already ended.
 */
export function decideConsent(
  credentials: Credentials,
  id: string,
  approved: boolean,
): Promise<{ redirectTo: string }> {
  return call<{ redirectTo: string }>(`/oauth/consent/${encodeURIComponent(id)}`, credentials, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ approved }),
  })
}

/**
 * An agent holding a grant, as Settings shows it.
 *
 * A grant, not a token: tokens rotate hourly, so "connected since" would drift
 * and revoking would have to chase every one. Revoked grants come back too —
 * losing one silently would make revocation feel like it might not have worked.
 */
export interface AgentGrant {
  id: string
  name: string
  uri: string | null
  /** The callbacks it registered — what tells a terminal from a hosted client. */
  redirectUris: string[]
  grantedAt: string
  lastUsedAt: string | null
  revokedAt: string | null
  scopes: { scope: string; title: string; detail: string }[]
}

export function listAgents(credentials: Credentials): Promise<{ agents: AgentGrant[] }> {
  return call<{ agents: AgentGrant[] }>('/agents', credentials)
}

export function revokeAgent(credentials: Credentials, id: string): Promise<void> {
  return call<void>(`/agents/${encodeURIComponent(id)}`, credentials, { method: 'DELETE' })
}

export function establishSession(credentials: Credentials): Promise<{ user: SessionUser }> {
  return call('/session', credentials, { method: 'POST' })
}

export const API_BASE = BASE
