import { and, desc, eq, isNull, lt, sql } from 'drizzle-orm'
import type { Db } from '../db/client.js'
import { schema } from '../db/client.js'
import { hashSecret, mintSecret } from './crypto.js'
import type { Scope } from './scopes.js'

/**
 * Every database touch the grant flow makes.
 *
 * Kept apart from the HTTP handlers so the rules that matter — a code is
 * single-use, a decided request cannot be decided twice — are enforced in one
 * place and can be tested without a server. Both are written as conditional
 * updates rather than read-then-write: two token requests arriving together
 * with the same code must not both succeed, and only the database can settle
 * that.
 */

const { oauthClients, oauthAuthRequests, oauthAuthCodes, oauthGrants, oauthTokens } = schema

/** Long enough for a person to read a consent screen, short enough to matter. */
export const AUTH_REQUEST_TTL_MS = 10 * 60 * 1000
/** RFC 7636 wants this brief; the client redeems it immediately. */
export const AUTH_CODE_TTL_MS = 60 * 1000
export const ACCESS_TOKEN_TTL_MS = 60 * 60 * 1000
/** The 90 days the consent screen promises. Say one thing in both places. */
export const REFRESH_TOKEN_TTL_MS = 90 * 24 * 60 * 60 * 1000

const later = (ms: number) => new Date(Date.now() + ms)

export interface RegisteredClient {
  clientId: string
  clientName: string
  redirectUris: string[]
  clientUri: string | null
}

export async function registerClient(
  db: Db,
  input: { clientName: string; redirectUris: string[]; clientUri?: string | null },
): Promise<RegisteredClient> {
  // Not a secret, but unguessable anyway: a predictable client id would let one
  // agent start a flow that looks like another agent's on the consent screen.
  const clientId = `otc_${mintSecret()}`
  const [row] = await db
    .insert(oauthClients)
    .values({
      clientId,
      clientName: input.clientName,
      redirectUris: input.redirectUris,
      clientUri: input.clientUri ?? null,
    })
    .returning()
  return {
    clientId: row!.clientId,
    clientName: row!.clientName,
    redirectUris: row!.redirectUris,
    clientUri: row!.clientUri,
  }
}

export async function findClient(db: Db, clientId: string): Promise<RegisteredClient | null> {
  const [row] = await db.select().from(oauthClients).where(eq(oauthClients.clientId, clientId))
  if (!row) return null
  return {
    clientId: row.clientId,
    clientName: row.clientName,
    redirectUris: row.redirectUris,
    clientUri: row.clientUri,
  }
}

export interface AuthRequestInput {
  clientId: string
  scopes: Scope[]
  resource: string
  redirectUri: string
  state: string | null
  codeChallenge: string
}

export interface AuthRequest extends AuthRequestInput {
  id: string
  expiresAt: Date
  decidedAt: Date | null
  approved: boolean | null
  userId: string | null
}

export async function createAuthRequest(db: Db, input: AuthRequestInput): Promise<AuthRequest> {
  const [row] = await db
    .insert(oauthAuthRequests)
    .values({ ...input, expiresAt: later(AUTH_REQUEST_TTL_MS) })
    .returning()
  return toAuthRequest(row!)
}

function toAuthRequest(row: typeof oauthAuthRequests.$inferSelect): AuthRequest {
  return {
    id: row.id,
    clientId: row.clientId,
    userId: row.userId,
    scopes: row.scopes as Scope[],
    resource: row.resource,
    redirectUri: row.redirectUri,
    state: row.state,
    codeChallenge: row.codeChallenge,
    expiresAt: row.expiresAt,
    decidedAt: row.decidedAt,
    approved: row.approved,
  }
}

export async function findAuthRequest(db: Db, id: string): Promise<AuthRequest | null> {
  const [row] = await db.select().from(oauthAuthRequests).where(eq(oauthAuthRequests.id, id))
  return row ? toAuthRequest(row) : null
}

/**
 * Record the answer, once.
 *
 * Conditional on the request still being undecided and unexpired, so a second
 * click — or a replayed POST — changes nothing and returns null. The caller
 * treats null as "already answered" rather than retrying.
 */
export async function decideAuthRequest(
  db: Db,
  input: { id: string; userId: string; approved: boolean },
): Promise<AuthRequest | null> {
  const [row] = await db
    .update(oauthAuthRequests)
    .set({ userId: input.userId, approved: input.approved, decidedAt: new Date() })
    .where(
      and(
        eq(oauthAuthRequests.id, input.id),
        isNull(oauthAuthRequests.decidedAt),
        sql`${oauthAuthRequests.expiresAt} > now()`,
      ),
    )
    .returning()
  return row ? toAuthRequest(row) : null
}

/** The code is returned once, here, and only its hash is kept. */
export async function mintAuthCode(db: Db, request: AuthRequest): Promise<string> {
  const code = mintSecret()
  await db.insert(oauthAuthCodes).values({
    codeHash: hashSecret(code),
    clientId: request.clientId,
    userId: request.userId!,
    scopes: request.scopes,
    codeChallenge: request.codeChallenge,
    redirectUri: request.redirectUri,
    resource: request.resource,
    requestId: request.id,
    expiresAt: later(AUTH_CODE_TTL_MS),
  })
  return code
}

export interface ConsumedCode {
  clientId: string
  userId: string
  scopes: Scope[]
  codeChallenge: string
  redirectUri: string
  resource: string | null
  /** The consent behind it, so a grant can be dated from when someone said yes. */
  requestId: string | null
}

/**
 * Redeem a code, exactly once.
 *
 * The consume and the read are one statement. Checking first and updating after
 * would leave a window where two simultaneous token requests both see an
 * unconsumed code, and RFC 7636 treats a replayed code as an attack.
 */
export async function consumeAuthCode(db: Db, code: string): Promise<ConsumedCode | null> {
  const [row] = await db
    .update(oauthAuthCodes)
    .set({ consumedAt: new Date() })
    .where(
      and(
        eq(oauthAuthCodes.codeHash, hashSecret(code)),
        isNull(oauthAuthCodes.consumedAt),
        sql`${oauthAuthCodes.expiresAt} > now()`,
      ),
    )
    .returning()
  if (!row) return null
  return {
    clientId: row.clientId,
    userId: row.userId,
    scopes: row.scopes as Scope[],
    codeChallenge: row.codeChallenge,
    redirectUri: row.redirectUri,
    resource: row.resource,
    requestId: row.requestId,
  }
}

/**
 * The standing grant behind a code exchange, created on the first exchange and
 * reused on every later one.
 *
 * Dated from the consent rather than from this moment: "connected since" should
 * be when a person approved it, and those differ by however long the agent took
 * to redeem the code.
 *
 * A second consent from the same agent lands on the existing row instead of
 * stacking a duplicate in Settings — the partial unique index enforces one live
 * grant per agent per person, and this is the read that respects it.
 */
export async function grantFor(db: Db, code: ConsumedCode): Promise<string> {
  const [existing] = await db
    .select({ id: oauthGrants.id })
    .from(oauthGrants)
    .where(
      and(
        eq(oauthGrants.userId, code.userId),
        eq(oauthGrants.clientId, code.clientId),
        isNull(oauthGrants.revokedAt),
      ),
    )
  if (existing) {
    // Scopes can change between consents, and the grant is what Settings shows.
    await db
      .update(oauthGrants)
      .set({ scopes: code.scopes })
      .where(eq(oauthGrants.id, existing.id))
    return existing.id
  }

  let grantedAt: Date | undefined
  if (code.requestId) {
    const request = await findAuthRequest(db, code.requestId)
    grantedAt = request?.decidedAt ?? undefined
  }

  const [row] = await db
    .insert(oauthGrants)
    .values({
      userId: code.userId,
      clientId: code.clientId,
      scopes: code.scopes,
      resource: code.resource,
      requestId: code.requestId,
      ...(grantedAt ? { grantedAt } : {}),
    })
    .returning({ id: oauthGrants.id })
  return row!.id
}

export interface AgentGrant {
  id: string
  clientId: string
  clientName: string
  clientUri: string | null
  scopes: Scope[]
  grantedAt: Date
  lastUsedAt: Date | null
  revokedAt: Date | null
}

/** What Settings lists: every agent this person has ever authorised. */
export async function listGrants(db: Db, userId: string): Promise<AgentGrant[]> {
  const rows = await db
    .select({
      id: oauthGrants.id,
      clientId: oauthGrants.clientId,
      clientName: oauthClients.clientName,
      clientUri: oauthClients.clientUri,
      scopes: oauthGrants.scopes,
      grantedAt: oauthGrants.grantedAt,
      lastUsedAt: oauthGrants.lastUsedAt,
      revokedAt: oauthGrants.revokedAt,
    })
    .from(oauthGrants)
    .innerJoin(oauthClients, eq(oauthClients.clientId, oauthGrants.clientId))
    .where(eq(oauthGrants.userId, userId))
    .orderBy(desc(oauthGrants.grantedAt))
  return rows.map((row) => ({ ...row, scopes: row.scopes as Scope[] }))
}

/**
 * Revoke a grant, and everything issued under it.
 *
 * Scoped to the user, so an id guessed from somewhere else revokes nothing.
 * Returns false when there was no live grant to revoke, which the route reports
 * rather than pretending something happened.
 *
 * The tokens are revoked too even though findToken already refuses a token
 * whose grant is revoked. Two independent reasons to say no is the point: this
 * is the control a person reaches for when they think something is wrong.
 */
export async function revokeGrant(db: Db, userId: string, grantId: string): Promise<boolean> {
  const now = new Date()
  const [row] = await db
    .update(oauthGrants)
    .set({ revokedAt: now })
    .where(
      and(
        eq(oauthGrants.id, grantId),
        eq(oauthGrants.userId, userId),
        isNull(oauthGrants.revokedAt),
      ),
    )
    .returning({ id: oauthGrants.id })
  if (!row) return false

  await db
    .update(oauthTokens)
    .set({ revokedAt: now })
    .where(and(eq(oauthTokens.grantId, grantId), isNull(oauthTokens.revokedAt)))
  return true
}

/**
 * Note that a grant was used, at most once a minute.
 *
 * The conditional is what keeps this off the hot path: Postgres skips the write
 * when the row was touched recently, so a chatty agent costs one update a minute
 * rather than one per tool call. Callers do not await it — a missed timestamp is
 * a cosmetic loss, and latency on a tool call is not.
 */
export async function touchGrant(db: Db, grantId: string): Promise<void> {
  await db
    .update(oauthGrants)
    .set({ lastUsedAt: new Date() })
    .where(
      and(
        eq(oauthGrants.id, grantId),
        sql`(${oauthGrants.lastUsedAt} is null or ${oauthGrants.lastUsedAt} < now() - interval '1 minute')`,
      ),
    )
}

export interface IssuedTokens {
  accessToken: string
  refreshToken: string
  expiresInSeconds: number
  scopes: Scope[]
}

export async function issueTokens(
  db: Db,
  grant: {
    clientId: string
    userId: string
    scopes: Scope[]
    resource: string | null
    grantId: string
  },
): Promise<IssuedTokens> {
  const accessToken = mintSecret()
  const refreshToken = mintSecret()
  await db.insert(oauthTokens).values([
    {
      tokenHash: hashSecret(accessToken),
      kind: 'access',
      ...grant,
      expiresAt: later(ACCESS_TOKEN_TTL_MS),
    },
    {
      tokenHash: hashSecret(refreshToken),
      kind: 'refresh',
      ...grant,
      expiresAt: later(REFRESH_TOKEN_TTL_MS),
    },
  ])
  return {
    accessToken,
    refreshToken,
    expiresInSeconds: Math.floor(ACCESS_TOKEN_TTL_MS / 1000),
    scopes: grant.scopes,
  }
}

export interface TokenGrant {
  id: string
  clientId: string
  userId: string
  scopes: Scope[]
  resource: string | null
  /** Null only for a token issued before grants existed. */
  grantId: string | null
}

/** A live token of the given kind, or null. Expired and revoked look the same. */
export async function findToken(
  db: Db,
  token: string,
  kind: 'access' | 'refresh',
): Promise<TokenGrant | null> {
  // Left join, because a token predating grants has none and is still valid;
  // the filter below only refuses a grant that exists and was revoked.
  const [row] = await db
    .select({ token: oauthTokens, grantRevokedAt: oauthGrants.revokedAt })
    .from(oauthTokens)
    .leftJoin(oauthGrants, eq(oauthGrants.id, oauthTokens.grantId))
    .where(
      and(
        eq(oauthTokens.tokenHash, hashSecret(token)),
        eq(oauthTokens.kind, kind),
        isNull(oauthTokens.revokedAt),
        sql`${oauthTokens.expiresAt} > now()`,
      ),
    )
  if (!row || row.grantRevokedAt) return null
  return {
    id: row.token.id,
    clientId: row.token.clientId,
    userId: row.token.userId,
    scopes: row.token.scopes as Scope[],
    resource: row.token.resource,
    grantId: row.token.grantId,
  }
}

/**
 * Revoke a token. Idempotent, and silent about whether it existed — RFC 7009
 * requires the endpoint to answer 200 either way, so a caller cannot use it to
 * discover which strings are real tokens.
 */
export async function revokeToken(db: Db, token: string): Promise<void> {
  await db
    .update(oauthTokens)
    .set({ revokedAt: new Date() })
    .where(and(eq(oauthTokens.tokenHash, hashSecret(token)), isNull(oauthTokens.revokedAt)))
}

/** Drop what can no longer be used. Called opportunistically, never on a hot path. */
export async function purgeExpired(db: Db): Promise<void> {
  const now = new Date()
  await db.delete(oauthAuthCodes).where(lt(oauthAuthCodes.expiresAt, now))
  await db.delete(oauthAuthRequests).where(lt(oauthAuthRequests.expiresAt, now))
}
