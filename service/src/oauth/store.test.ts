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
  grantFor,
  issueTokens,
  listGrants,
  mintAuthCode,
  registerClient,
  revokeGrant,
  revokeToken,
  touchGrant,
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

/** Walk a full exchange and come back with the grant it created. */
async function grantedTokens(scopes?: ('wallets:read' | 'plans:read' | 'plans:write')[]) {
  const request = await parked(scopes ? { scopes } : {})
  const decided = await decideAuthRequest(db, { id: request.id, userId, approved: true })
  const code = await mintAuthCode(db, decided!)
  const consumed = await consumeAuthCode(db, code)
  const grantId = await grantFor(db, consumed!)
  const tokens = await issueTokens(db, {
    clientId: consumed!.clientId,
    userId: consumed!.userId,
    scopes: consumed!.scopes,
    resource: consumed!.resource,
    grantId,
  })
  return { grantId, tokens }
}

describe('a grant is the unit a person sees and revokes', () => {
  it('dates itself from the consent, not from the exchange', async () => {
    const request = await parked()
    const decided = await decideAuthRequest(db, { id: request.id, userId, approved: true })
    const code = await mintAuthCode(db, decided!)
    const consumed = await consumeAuthCode(db, code)
    const grantId = await grantFor(db, consumed!)

    const grant = (await listGrants(db, userId)).find((g) => g.id === grantId)
    // Within a second of when the person said yes. The exchange came later, and
    // "connected since" should mean the moment they approved it.
    expect(
      Math.abs(grant!.grantedAt.getTime() - decided!.decidedAt!.getTime()),
    ).toBeLessThan(1000)
  })

  /**
   * Reconnecting the same agent must not stack a second row saying the same
   * thing. The partial unique index enforces it; this is the read that respects
   * it, and it updates the scopes because that is what the newer consent said.
   */
  it('reuses the live grant when the same agent connects again', async () => {
    const first = await grantedTokens()
    const second = await grantedTokens(['wallets:read'])
    expect(second.grantId).toBe(first.grantId)

    const mine = (await listGrants(db, userId)).filter((g) => g.id === first.grantId)
    expect(mine).toHaveLength(1)
    expect(mine[0]!.scopes).toEqual(['wallets:read'])
  })

  it('kills every token under it the moment it is revoked', async () => {
    const { grantId, tokens } = await grantedTokens()
    expect(await findToken(db, tokens.accessToken, 'access')).not.toBeNull()

    expect(await revokeGrant(db, userId, grantId)).toBe(true)
    expect(await findToken(db, tokens.accessToken, 'access')).toBeNull()
    expect(await findToken(db, tokens.refreshToken, 'refresh')).toBeNull()
  })

  /** An id from somewhere else must revoke nothing. */
  it('refuses to revoke a grant belonging to someone else', async () => {
    const { grantId, tokens } = await grantedTokens()
    const stranger = await userIdForDid(db, 'did:privy:not-the-owner')

    expect(await revokeGrant(db, stranger, grantId)).toBe(false)
    expect(await findToken(db, tokens.accessToken, 'access')).not.toBeNull()
  })

  it('reports that a second revoke did nothing', async () => {
    const { grantId } = await grantedTokens()
    expect(await revokeGrant(db, userId, grantId)).toBe(true)
    expect(await revokeGrant(db, userId, grantId)).toBe(false)
  })

  /**
   * Revoked grants stay listed. Losing one silently would make revocation feel
   * like it might not have worked, on the screen where that doubt is least
   * acceptable.
   */
  it('keeps a revoked grant in the list, marked', async () => {
    const { grantId } = await grantedTokens()
    await revokeGrant(db, userId, grantId)
    const grant = (await listGrants(db, userId)).find((g) => g.id === grantId)
    expect(grant).toBeDefined()
    expect(grant!.revokedAt).not.toBeNull()
  })

  it('records use, and then leaves it alone for a minute', async () => {
    const { grantId } = await grantedTokens()
    await touchGrant(db, grantId)
    const first = (await listGrants(db, userId)).find((g) => g.id === grantId)!.lastUsedAt
    expect(first).not.toBeNull()

    // The second touch is inside the window, so it must not write. That is what
    // keeps a chatty agent from costing one update per tool call.
    await touchGrant(db, grantId)
    const second = (await listGrants(db, userId)).find((g) => g.id === grantId)!.lastUsedAt
    expect(second!.getTime()).toBe(first!.getTime())
  })
})

describe('tokens', () => {
  it('issues an access and a refresh token that both resolve to the grant', async () => {
    const { tokens } = await grantedTokens(['wallets:read'])

    const access = await findToken(db, tokens.accessToken, 'access')
    expect(access?.userId).toBe(userId)
    expect(access?.resource).toBe(RESOURCE)
    expect(access?.scopes).toEqual(['wallets:read'])

    expect(await findToken(db, tokens.refreshToken, 'refresh')).not.toBeNull()
  })

  /** Kind is part of identity: a refresh token is not an access token. */
  it('will not accept a refresh token where an access token is required', async () => {
    const { tokens } = await grantedTokens(['wallets:read'])
    expect(await findToken(db, tokens.refreshToken, 'access')).toBeNull()
    expect(await findToken(db, tokens.accessToken, 'refresh')).toBeNull()
  })

  it('stops accepting a revoked token immediately', async () => {
    const { tokens } = await grantedTokens(['wallets:read'])
    await revokeToken(db, tokens.accessToken)
    expect(await findToken(db, tokens.accessToken, 'access')).toBeNull()
  })

  it('stops accepting an expired token', async () => {
    const { tokens } = await grantedTokens(['wallets:read'])
    await pg.exec(`update oauth_tokens set expires_at = now() - interval '1 second'`)
    expect(await findToken(db, tokens.accessToken, 'access')).toBeNull()
  })

  /**
   * Only the hash is stored. A leaked table has to be useless on its own, which
   * is the entire reason these are not stored as issued.
   */
  it('never stores the token it handed out', async () => {
    const { tokens } = await grantedTokens(['wallets:read'])
    const rows = await pg.query<{ token_hash: string }>('select token_hash from oauth_tokens')
    const hashes = rows.rows.map((r) => r.token_hash)
    expect(hashes).not.toContain(tokens.accessToken)
    expect(hashes).not.toContain(tokens.refreshToken)
  })
})
