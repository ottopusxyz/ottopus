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

/**
 * The MCP endpoint people paste into an agent, as an override.
 *
 * Set this only to pin the value. Unset is the normal case, and then the
 * service is asked — see fetchMcpUrl.
 */
const MCP_URL_OVERRIDE = process.env.NEXT_PUBLIC_MCP_URL?.trim().replace(/\/$/, '') || null

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

/**
 * Ask the service where its MCP surface is.
 *
 * This used to be derived here: the API base with /api swapped for /mcp. That
 * is right on a laptop, where both are paths on one origin, and wrong in
 * production, where they are separate subdomains — it produced
 * https://api.ottopus.xyz/mcp, which answers 404. Someone pasted it into their
 * agent and got a dead address.
 *
 * The browser cannot work this out. mcpUrl is the OAuth issuer and RFC 8707
 * compares tokens against it as a string, so what a person copies has to be the
 * same string the service binds tokens to, not a second spelling that happens
 * to agree. There is one source for it, and it is the service.
 *
 * No fallback on failure, deliberately. A guessed URL that 404s is worse than
 * no URL: it looks like the agent is broken rather than the address.
 */
export async function fetchMcpUrl(): Promise<string> {
  if (MCP_URL_OVERRIDE) return MCP_URL_OVERRIDE
  const response = await fetch(`${BASE}/meta`)
  if (!response.ok) throw new ApiError(response.status, 'GET /meta failed')
  const { mcpUrl } = (await response.json()) as { mcpUrl?: string }
  if (!mcpUrl) throw new ApiError(response.status, 'GET /meta returned no mcpUrl')
  return mcpUrl.replace(/\/$/, '')
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
 * How an asset is held. `wallet` is the only one a plan can spend, and the
 * only one in the token list — everything else sits under its protocol.
 */
export type PositionType =
  | 'wallet'
  | 'deposit'
  | 'loan'
  | 'locked'
  | 'staked'
  | 'reward'
  | 'investment'

/** How a protocol position is held. Never `wallet`. */
export type ProtocolPositionType = Exclude<PositionType, 'wallet'>

/** Where inside a protocol a position sits. The provider's vocabulary. */
export type ProtocolModule =
  | 'deposit'
  | 'lending'
  | 'yield'
  | 'liquidity_pool'
  | 'staked'
  | 'leveraged_farming'
  | 'nft_staked'
  | 'farming'
  | 'locked'
  | 'vesting'
  | 'rewards'
  | 'investment'

/** Why an arm's balances are missing. `ok` means they are not. */
export type ArmStatus = 'ok' | 'untracked_address' | 'rate_limited' | 'unavailable' | 'not_configured'

export interface ArmSummary {
  walletId: string
  address: string
  status: ArmStatus
  /** Net: what the arm holds less what it owes. */
  total: number
  change1d: number
  positionCount: number
}

/** One arm's share of a token row. */
export interface Holding {
  walletId: string
  /** Base units. */
  amount: string
  value: number | null
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

/** A loose balance: one asset, on one chain, across every arm. Every amount here is spendable. */
export interface AssetRow {
  /** CAIP-19 — one asset, on one chain, across every arm. */
  assetId: string
  chainId: string
  asset: AssetInfo
  /** Base units, summed across arms. Never a number. */
  amount: string
  /** Never negative: debt is not a token you hold. */
  value: number
  price: number | null
  change1d: number
  /** Fraction of the net total, 0..1. */
  share: number
  holdings: Holding[]
}

/** One position of one arm inside a protocol. */
export interface ProtocolHolding {
  walletId: string
  assetId: string
  chainId: string
  asset: AssetInfo
  positionType: ProtocolPositionType
  /** Base units. */
  amount: string
  /** A magnitude. For a loan, what is owed. Null when unpriced. */
  value: number | null
  price: number | null
  /** As the provider reports it. For a loan, the change in what is owed. */
  change1d: number | null
}

/** What the app treats as one thing: a lending market, a pool, a vault. */
export interface PositionGroup {
  id: string
  chainId: string
  name: string
  module: ProtocolModule | null
  /** Net: deposits less loans. Negative for debt with nothing beside it. A floor when `unpriced` is above zero. */
  value: number
  change1d: number
  /** Holdings with no price. They count as nothing in `value`. */
  unpriced: number
  holdings: ProtocolHolding[]
}

export interface ProtocolRow {
  id: string
  name: string
  iconUrl: string | null
  url: string | null
  /** Net across every group. */
  value: number
  change1d: number
  /** Fraction of the net total, 0..1. Zero when net debt or partly unpriced. */
  share: number
  /** Unpriced holdings across every group. */
  unpriced: number
  groups: PositionGroup[]
}

export interface ChainRow {
  iconUrl?: string | null
  chainId: string
  name: string
  /** Net across tokens and protocols on this chain. */
  value: number
  share: number
}

/** Magnitudes per way of holding — what is loose, deposited, owed, staked, and so on. */
export type ValueByType = Record<PositionType, number>

export interface Portfolio {
  provider: string
  currency: string
  asOf: string
  /** Net worth: everything held less everything owed, across every arm that could be read. */
  total: number
  change1d: number
  byType: ValueByType
  /** Holdings with no price anywhere. `total` leaves them out. */
  unpriced: number
  arms: ArmSummary[]
  chains: ChainRow[]
  /** Loose balances only. */
  assets: AssetRow[]
  /** One card per app, biggest first. */
  protocols: ProtocolRow[]
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

/**
 * Plans, as the review page and Requests read them.
 *
 * The service verified everything here before it was stored, and the browser
 * renders it as given: it never recomputes or checks planHash, never decodes
 * calldata itself. What it does is show, gate, and forward a signature.
 */
export type PlanStatusName =
  | 'draft'
  | 'awaiting_review'
  | 'awaiting_signature'
  | 'submitted'
  | 'confirmed'
  | 'failed'
  | 'expired'
  | 'blocked'
  | 'superseded'
  | 'cancelled'

export interface PlanCall {
  to: string
  value: string
  data: string
  chainId: string
}

export interface DecodedAction {
  target: string
  isContract: boolean
  source: 'native' | 'abi' | 'sourcify' | '4byte' | 'unknown'
  verified: boolean
  contractName?: string
  function: string
  args: { name: string; type: string; value: string }[]
  value: string
  approval?: { spender: string; amount: string }
}

export interface PlanWarning {
  severity: 'info' | 'caution' | 'block'
  code: string
  message: string
  saferAlternative?: string
}

export interface TransferIntent {
  kind: 'transfer'
  asset: string
  amount: string
  to: string
  toName?: string
  fromAccount?: string
  note?: string
}

/** Other kinds arrive with later milestones; the page shows what it knows and never guesses. */
/**
 * A swap or a bridge. Identical fields; the chains of `from` and `to` decide
 * which it is, the same way the service decides.
 */
export interface TradeIntent {
  kind: 'swap' | 'bridge'
  from: string
  to: string
  amountIn?: string
  amountOut?: string
  slippageBps?: number
  fromAccount?: string
  note?: string
}

/**
 * Calls the agent authored itself, with its declaration of what they do.
 * The declaration is the intent: it is what was hashed, and the page shows
 * it beside what the simulation actually saw.
 */
export interface CustomIntent {
  kind: 'custom'
  fromAccount: string
  chainId: string
  summary: string
  /** The most of each asset that may leave. A bound, not a figure. */
  expectedChanges: { asset: string; maxOut: string }[]
  approvals: { asset: string; spender: string; amount: string }[]
  nativeValue?: string
  note?: string
}

export type PlanIntent = TransferIntent | TradeIntent | CustomIntent | { kind: 'supply'; [key: string]: unknown }

export interface Plan {
  id: string
  version: number
  userId: string
  createdVia: 'agent' | 'web'
  intent: PlanIntent
  provenance: 'route_provider' | 'agent_crafted'
  resolution: {
    account: { caip10: string; label?: string }
    candidatesConsidered: { account: string; label?: string; reason: string }[]
    reason: string
  }
  outcome:
    | { type: 'calls'; calls: PlanCall[] }
    | { type: 'signature'; eip712: unknown }
    | { type: 'permission'; request: unknown }
  quote: { provider: string; expiresAt: string; expectedOut?: string; minOut?: string }
  humanPlan: {
    summary: string
    steps: string[]
    feesUsd: string
    warnings: PlanWarning[]
    /** What to call each asset the plan moves. Absent on plans stored before it existed. */
    assets?: { id: string; symbol: string; decimals: number }[]
  }
  status: PlanStatusName
  expiresAt: string
  planHash: string
  decodedActions: DecodedAction[]
  simulation: Simulation | null
}

/** One balance the simulation watched move. Signed base units; negative leaves. */
export interface AssetDelta {
  assetId: string
  symbol: string | null
  decimals: number | null
  diff: string
  pre: string
  post: string
}

/**
 * What the simulation observed. A prediction, never a guarantee — the page
 * says so, because a green result is not a safety claim.
 */
export interface Simulation {
  provider: string
  chainId: string
  blockNumber: string
  success: boolean
  assetChanges: AssetDelta[]
  /** Whether balances were read at all, as opposed to read and found unchanged. */
  tracedAssets?: boolean
  gasUsed: string
  gasUsd: string
  revertReason?: string
  failedCall?: number
  resultHash: string
  ranAt: string
}

/**
 * What the page draws beside the plan, looked up by the ids the plan carries.
 * Never inside the plan: the hash is over the plan alone, and a missing icon
 * must never make a plan unreadable.
 */
export interface Visuals {
  assets: Record<string, { symbol: string; name: string; iconUrl: string | null }>
  chains: Record<string, ChainVisual>
  wallets: Record<string, { walletType: string; label: string | null }>
}

/**
 * A chain's words, plus the CAIP-19 id of its own currency.
 *
 * The native asset id comes from the service because the SLIP-44 table lives
 * in core. The page needs it to name the native row that its own simulation
 * reports as a bare sentinel address, and a page that assumed coin type 60
 * would label BNB as ETH.
 */
export interface ChainVisual {
  name: string
  iconUrl: string | null
  nativeAssetId: string | null
  nativeSymbol: string
  nativeDecimals: number
}

export interface ReviewRead {
  plan: Plan
  walletId: string | null
  statusAt: string
  /** What the latest event carried: the tx hash once submitted, a reason once failed. */
  statusDetail: { txHash?: string; reason?: string } | null
  link: { expiresAt: string }
  visuals?: Visuals
}

/** The plan behind a review link. A dead or foreign token is a 404, and says nothing more. */
export function readReview(credentials: Credentials, token: string): Promise<ReviewRead> {
  return call<ReviewRead>(`/plans/${encodeURIComponent(token)}`, credentials)
}

/** The transitions a browser may write. Anything else is the service's to decide. */
export type WebTransition =
  | { status: 'awaiting_review' | 'awaiting_signature' | 'cancelled' }
  | { status: 'submitted'; detail: { txHash: string } }
  /** The hash rides along, as it does from the receipt job, so a reopened page can still point at the explorer. */
  | { status: 'confirmed'; detail?: { txHash: string } }
  | { status: 'failed'; detail?: { reason: string; txHash?: string } }

export function movePlan(
  credentials: Credentials,
  planId: string,
  version: number,
  transition: WebTransition,
): Promise<{ status: PlanStatusName }> {
  return call<{ status: PlanStatusName }>(`/plans/${encodeURIComponent(planId)}/events`, credentials, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ version, ...transition }),
  })
}

/** A list row: what the plan is, in words, plus what the portfolio knows beside it. */
export interface PlanSummary {
  id: string
  version: number
  status: PlanStatusName
  kind: 'transfer' | 'swap' | 'bridge' | 'supply'
  summary: string
  reason: string
  account: { caip10: string; label?: string }
  chainId: string
  asset: { id: string; amount: string; symbol: string | null; decimals: number | null } | null
  recipient: { address: string; name: string | null } | null
  blockedReason: string | null
  createdVia: 'agent' | 'web'
  expiresAt: string
  createdAt: string
  statusAt: string
  assetIconUrl: string | null
  chainIconUrl: string | null
  valueUsd: number | null
  wallet: { walletType: string; label: string | null } | null
}

/** Waiting on me only; what the nav badge polls. */
export function listPendingPlans(credentials: Credentials): Promise<{ plans: PlanSummary[]; count: number }> {
  return call('/plans?pending=1', credentials)
}

/** Every status, waiting-on-me first and then newest. */
export function listPlans(credentials: Credentials): Promise<{ plans: PlanSummary[]; count: number }> {
  return call('/plans', credentials)
}

/** A fresh link to my own pending plan, for a Requests row. */
export function linkToPlan(
  credentials: Credentials,
  planId: string,
): Promise<{ token: string; url: string; expiresAt: string }> {
  return call(`/plans/${encodeURIComponent(planId)}/link`, credentials, { method: 'POST' })
}
