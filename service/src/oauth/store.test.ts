import { PGlite } from '@electric-sql/pglite'
import { drizzle } from 'drizzle-orm/pglite'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { userIdForDid } from '../auth/session.js'
import { migrationFiles, statementsIn } from '../db/migrate.js'
import * as schema from '../db/schema.js'
import { verifyPkce } from './crypto.js'
import {
  consumeAuthCode,
  createAuthRequest,
  decideAuthRequest,
  findToken,
  issueTokens,
  mintAuthCode,
  registerClient,
  revokeToken,
  type AuthRequest,
} from './store.js'

/**
 * Against real Postgres, because the parts worth testing are the ones the
 * database enforces: a code redeemed once, a request decided once, a check
 * constraint that will not store an approval with nobody behind it. A mock of
 * the store would agree with whatever the store already believes.
 *
 * These are the OAuth equivalents of the plan invariants — a replayed code and
 * a token minted for another audience are how an agent surface gets used by
 * someone it was never granted to.
 */
let db: ReturnType<typeof drizzle<typeof schema>>
let pg: PGlite
let userId: string
let clientId: string

const RESOURCE = 'https://mcp.example.test'

beforeAll(async () => {
  pg = await PGlite.create()
  await pg.exec(`create role anon; create role authenticated; create role service_role;`)
  for (const file of await migrationFiles(new URL('../../drizzle', import.meta.url).pathname)) {
    for (const stmt of await statementsIn(file)) await pg.exec(stmt)
  }
  db = drizzle(pg, { schema, casing: 'snake_case' })
  userId = await userIdForDid(db, 'did:privy:grant-owner')
}, 60_000)

beforeEach(async () => {
  const client = await registerClient(db, {
    clientName: 'Test agent',
    redirectUris: ['https://agent.example/callback'],
  })
  clientId = client.clientId
})

/** The S256 pair a client would generate. Fixed, so the test is deterministic. */
const VERIFIER = 'a'.repeat(64)
const CHALLENGE = '_-BU_nrgy23GXDr5th1SCfQ5hR20PQulmXM33xVGaOs'

async function parked(overrides: Partial<Parameters<typeof createAuthRequest>[1]> = {}) {
  return createAuthRequest(db, {
    clientId,
    scopes: ['wallets:read', 'plans:read', 'plans:write'],
    resource: RESOURCE,
    redirectUri: 'https://agent.example/callback',
    state: 'xyz',
    codeChallenge: CHALLENGE,
    ...overrides,
  })
}

async function approved(): Promise<AuthRequest> {
  const request = await parked()
  const decided = await decideAuthRequest(db, { id: request.id, userId, approved: true })
  expect(decided).not.toBeNull()
  return decided!
}

describe('the challenge and verifier actually correspond', () => {
  it('matches the fixture the rest of these tests rely on', () => {
    expect(verifyPkce(VERIFIER, CHALLENGE)).toBe(true)
  })
})

describe('a parked request is answered once', () => {
  it('records the decision and the person who made it', async () => {
    const decided = await approved()
    expect(decided.approved).toBe(true)
    expect(decided.userId).toBe(userId)
    expect(decided.decidedAt).not.toBeNull()
  })

  /**
   * The second click, the replayed POST, the back button. All the same thing:
   * a request that already has an answer must not acquire another one, or one
   * consent screen mints two codes.
   */
  it('refuses a second decision', async () => {
    const request = await parked()
    expect(await decideAuthRequest(db, { id: request.id, userId, approved: true })).not.toBeNull()
    expect(await decideAuthRequest(db, { id: request.id, userId, approved: false })).toBeNull()
  })

  it('refuses to decide an expired request', async () => {
    const request = await parked()
    await pg.exec(
      `update oauth_auth_requests set expires_at = now() - interval '1 minute' where id = '${request.id}'`,
    )
    expect(await decideAuthRequest(db, { id: request.id, userId, approved: true })).toBeNull()
  })

  /**
   * The check constraint, not the application. The service connects as the
   * table owner, so a bug here has nothing above it — an approval with no user
   * behind it would mint a token for nobody.
   */
  it('will not store an approval with no user, at the database level', async () => {
    const request = await parked()
    await expect(
      pg.exec(
        `update oauth_auth_requests set decided_at = now(), approved = true where id = '${request.id}'`,
      ),
    ).rejects.toThrow()
  })
})

describe('an authorization code is single use', () => {
  it('redeems once and never again', async () => {
    const code = await mintAuthCode(db, await approved())

    const first = await consumeAuthCode(db, code)
    expect(first?.userId).toBe(userId)
    expect(first?.resource).toBe(RESOURCE)

    expect(await consumeAuthCode(db, code)).toBeNull()
  })

  it('does not redeem an expired code', async () => {
    const code = await mintAuthCode(db, await approved())
    await pg.exec(`update oauth_auth_codes set expires_at = now() - interval '1 second'`)
    expect(await consumeAuthCode(db, code)).toBeNull()
  })

  it('does not redeem a code nobody issued', async () => {
    expect(await consumeAuthCode(db, 'not-a-code')).toBeNull()
  })

  /**
   * Two token requests arriving together on one code. Exactly one may win —
   * this is the reason consume is a conditional update rather than a read
   * followed by a write.
   */
  it('lets exactly one of two simultaneous redemptions win', async () => {
    const code = await mintAuthCode(db, await approved())
    const [a, b] = await Promise.all([consumeAuthCode(db, code), consumeAuthCode(db, code)])
    expect([a, b].filter(Boolean)).toHaveLength(1)
  })

  it('carries the challenge through, so PKCE can still be checked at the token endpoint', async () => {
    const code = await mintAuthCode(db, await approved())
    const consumed = await consumeAuthCode(db, code)
    expect(verifyPkce(VERIFIER, consumed!.codeChallenge)).toBe(true)
    expect(verifyPkce('b'.repeat(64), consumed!.codeChallenge)).toBe(false)
  })
})

describe('tokens', () => {
  const grant = () => ({
    clientId,
    userId,
    scopes: ['wallets:read'] as const,
    resource: RESOURCE,
  })

  it('issues an access and a refresh token that both resolve to the grant', async () => {
    const tokens = await issueTokens(db, { ...grant(), scopes: ['wallets:read'] })

    const access = await findToken(db, tokens.accessToken, 'access')
    expect(access?.userId).toBe(userId)
    expect(access?.resource).toBe(RESOURCE)
    expect(access?.scopes).toEqual(['wallets:read'])

    expect(await findToken(db, tokens.refreshToken, 'refresh')).not.toBeNull()
  })

  /** Kind is part of identity: a refresh token is not an access token. */
  it('will not accept a refresh token where an access token is required', async () => {
    const tokens = await issueTokens(db, { ...grant(), scopes: ['wallets:read'] })
    expect(await findToken(db, tokens.refreshToken, 'access')).toBeNull()
    expect(await findToken(db, tokens.accessToken, 'refresh')).toBeNull()
  })

  it('stops accepting a revoked token immediately', async () => {
    const tokens = await issueTokens(db, { ...grant(), scopes: ['wallets:read'] })
    await revokeToken(db, tokens.accessToken)
    expect(await findToken(db, tokens.accessToken, 'access')).toBeNull()
  })

  it('stops accepting an expired token', async () => {
    const tokens = await issueTokens(db, { ...grant(), scopes: ['wallets:read'] })
    await pg.exec(`update oauth_tokens set expires_at = now() - interval '1 second'`)
    expect(await findToken(db, tokens.accessToken, 'access')).toBeNull()
  })

  /**
   * Only the hash is stored. A leaked table has to be useless on its own, which
   * is the entire reason these are not stored as issued.
   */
  it('never stores the token it handed out', async () => {
    const tokens = await issueTokens(db, { ...grant(), scopes: ['wallets:read'] })
    const rows = await pg.query<{ token_hash: string }>('select token_hash from oauth_tokens')
    const hashes = rows.rows.map((r) => r.token_hash)
    expect(hashes).not.toContain(tokens.accessToken)
    expect(hashes).not.toContain(tokens.refreshToken)
  })
})
