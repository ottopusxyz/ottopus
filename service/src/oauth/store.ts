import { and, eq, isNull, lt, sql } from 'drizzle-orm'
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

const { oauthClients, oauthAuthRequests, oauthAuthCodes, oauthTokens } = schema

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
  }
}

export interface IssuedTokens {
  accessToken: string
  refreshToken: string
  expiresInSeconds: number
  scopes: Scope[]
}

export async function issueTokens(
  db: Db,
  grant: { clientId: string; userId: string; scopes: Scope[]; resource: string | null },
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
}

/** A live token of the given kind, or null. Expired and revoked look the same. */
export async function findToken(
  db: Db,
  token: string,
  kind: 'access' | 'refresh',
): Promise<TokenGrant | null> {
  const [row] = await db
    .select()
    .from(oauthTokens)
    .where(
      and(
        eq(oauthTokens.tokenHash, hashSecret(token)),
        eq(oauthTokens.kind, kind),
        isNull(oauthTokens.revokedAt),
        sql`${oauthTokens.expiresAt} > now()`,
      ),
    )
  if (!row) return null
  return {
    id: row.id,
    clientId: row.clientId,
    userId: row.userId,
    scopes: row.scopes as Scope[],
    resource: row.resource,
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
