import { PGlite } from '@electric-sql/pglite'
import { drizzle } from 'drizzle-orm/pglite'
import { beforeAll, describe, expect, it } from 'vitest'
import { migrationFiles, statementsIn } from '../db/migrate.js'
import * as schema from '../db/schema.js'
import { resourceUrl } from './metadata.js'
import { oauthRoutes } from './routes.js'
import { decideAuthRequest, mintAuthCode, registerClient } from './store.js'
import { userIdForDid } from '../auth/session.js'

/**
 * The endpoints, over HTTP, with a real database underneath.
 *
 * Weighted toward the failures rather than the happy path: an authorize
 * endpoint that redirects an error to an unvalidated URI is an open redirect,
 * and a token endpoint that skips PKCE hands the grant to whoever intercepted
 * the code. Those are the two ways this surface gets someone robbed.
 */
let db: ReturnType<typeof drizzle<typeof schema>>
let app: ReturnType<typeof oauthRoutes>
let userId: string

const REDIRECT = 'https://agent.example/callback'
const VERIFIER = 'a'.repeat(64)
const CHALLENGE = '_-BU_nrgy23GXDr5th1SCfQ5hR20PQulmXM33xVGaOs'

beforeAll(async () => {
  const pg = await PGlite.create()
  await pg.exec(`create role anon; create role authenticated; create role service_role;`)
  for (const file of await migrationFiles(new URL('../../drizzle', import.meta.url).pathname)) {
    for (const stmt of await statementsIn(file)) await pg.exec(stmt)
  }
  db = drizzle(pg, { schema, casing: 'snake_case' })
  app = oauthRoutes(db)
  userId = await userIdForDid(db, 'did:privy:route-owner')
}, 60_000)

const client = () =>
  registerClient(db, { clientName: 'Test agent', redirectUris: [REDIRECT] })

function authorizeUrl(params: Record<string, string>): string {
  const url = new URL('http://mcp.test/authorize')
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  return url.toString()
}

const validParams = (clientId: string) => ({
  response_type: 'code',
  client_id: clientId,
  redirect_uri: REDIRECT,
  code_challenge: CHALLENGE,
  code_challenge_method: 'S256',
  state: 'xyz',
})

/** Walk the whole flow and come back with a redeemable code. */
async function codeFor(clientId: string): Promise<string> {
  const response = await app.request(authorizeUrl(validParams(clientId)))
  const consent = new URL(response.headers.get('location')!)
  const requestId = consent.searchParams.get('request')!
  const decided = await decideAuthRequest(db, { id: requestId, userId, approved: true })
  return mintAuthCode(db, decided!)
}

const form = (fields: Record<string, string>) =>
  new Request('http://mcp.test/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(fields).toString(),
  })

describe('registration', () => {
  it('refuses a redirect URI we would not send a browser to', async () => {
    const response = await app.request('http://mcp.test/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ redirect_uris: ['http://evil.example/callback'] }),
    })
    expect(response.status).toBe(400)
    expect((await response.json()).error).toBe('invalid_redirect_uri')
  })

  /** How every desktop agent receives its callback. */
  it('accepts loopback http, which native clients need', async () => {
    const response = await app.request('http://mcp.test/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ redirect_uris: ['http://127.0.0.1:41234/cb'] }),
    })
    expect(response.status).toBe(201)
    expect((await response.json()).token_endpoint_auth_method).toBe('none')
  })
})

describe('the authorize endpoint never redirects to an unvalidated URI', () => {
  it('renders, rather than redirects, when the client is unknown', async () => {
    const response = await app.request(
      authorizeUrl({ ...validParams('otc_nobody'), client_id: 'otc_nobody' }),
    )
    expect(response.status).toBe(400)
    expect(response.headers.get('location')).toBeNull()
  })

  /**
   * The open redirect. An attacker registers nothing and simply asks us to
   * bounce an error to a URI of their choosing — so the mismatch has to be
   * answered here, not at the URI.
   */
  it('renders, rather than redirects, when the redirect URI is not registered', async () => {
    const { clientId } = await client()
    const response = await app.request(
      authorizeUrl({ ...validParams(clientId), redirect_uri: 'https://attacker.example/steal' }),
    )
    expect(response.status).toBe(400)
    expect(response.headers.get('location')).toBeNull()
  })
})

describe('the authorize endpoint', () => {
  it('parks the request and sends the browser to consent', async () => {
    const { clientId } = await client()
    const response = await app.request(authorizeUrl(validParams(clientId)))
    expect(response.status).toBe(302)

    const location = new URL(response.headers.get('location')!)
    expect(location.pathname).toBe('/oauth/consent')
    expect(location.searchParams.get('request')).toBeTruthy()
    // Only the id travels. Anything else here would be something the consent
    // page could be talked into displaying.
    expect([...location.searchParams.keys()]).toEqual(['request'])
  })

  it('refuses a request with no PKCE challenge, back at the registered URI', async () => {
    const { clientId } = await client()
    const params = validParams(clientId)
    delete (params as Partial<typeof params>).code_challenge
    const response = await app.request(authorizeUrl(params as Record<string, string>))

    const location = new URL(response.headers.get('location')!)
    expect(location.origin + location.pathname).toBe(REDIRECT)
    expect(location.searchParams.get('error')).toBe('invalid_request')
    // RFC 9207, on errors too, so a client can tell who refused.
    expect(location.searchParams.get('iss')).toBe(resourceUrl())
    expect(location.searchParams.get('state')).toBe('xyz')
  })

  it('refuses plain PKCE, which OAuth 2.1 forbids for a public client', async () => {
    const { clientId } = await client()
    const response = await app.request(
      authorizeUrl({ ...validParams(clientId), code_challenge_method: 'plain' }),
    )
    const location = new URL(response.headers.get('location')!)
    expect(location.searchParams.get('error')).toBe('invalid_request')
  })

  /** RFC 8707. A token for someone else's audience is not ours to mint. */
  it('refuses a resource that names another server', async () => {
    const { clientId } = await client()
    const response = await app.request(
      authorizeUrl({ ...validParams(clientId), resource: 'https://someone.else/mcp' }),
    )
    const location = new URL(response.headers.get('location')!)
    expect(location.searchParams.get('error')).toBe('invalid_target')
  })

  it('accepts our own resource', async () => {
    const { clientId } = await client()
    const response = await app.request(
      authorizeUrl({ ...validParams(clientId), resource: resourceUrl() }),
    )
    expect(new URL(response.headers.get('location')!).pathname).toBe('/oauth/consent')
  })
})

describe('the token endpoint', () => {
  it('exchanges a code with the matching verifier', async () => {
    const { clientId } = await client()
    const code = await codeFor(clientId)

    const response = await app.request(
      form({ grant_type: 'authorization_code', code, code_verifier: VERIFIER, client_id: clientId }),
    )
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.token_type).toBe('Bearer')
    expect(body.access_token).toBeTruthy()
    expect(body.refresh_token).toBeTruthy()
  })

  /** The whole point of PKCE: a stolen code alone is worth nothing. */
  it('refuses a code presented with the wrong verifier', async () => {
    const { clientId } = await client()
    const code = await codeFor(clientId)

    const response = await app.request(
      form({ grant_type: 'authorization_code', code, code_verifier: 'b'.repeat(64) }),
    )
    expect(response.status).toBe(400)
    expect((await response.json()).error).toBe('invalid_grant')
  })

  it('refuses a replayed code', async () => {
    const { clientId } = await client()
    const code = await codeFor(clientId)
    const exchange = () =>
      app.request(form({ grant_type: 'authorization_code', code, code_verifier: VERIFIER }))

    expect((await exchange()).status).toBe(200)
    expect((await exchange()).status).toBe(400)
  })

  it('refuses a code redeemed by a different client', async () => {
    const { clientId } = await client()
    const other = await client()
    const code = await codeFor(clientId)

    const response = await app.request(
      form({
        grant_type: 'authorization_code',
        code,
        code_verifier: VERIFIER,
        client_id: other.clientId,
      }),
    )
    expect(response.status).toBe(400)
    expect((await response.json()).error).toBe('invalid_grant')
  })

  /** Rotation: a stolen refresh token is good once, not for ninety days. */
  it('rotates the refresh token and kills the one presented', async () => {
    const { clientId } = await client()
    const code = await codeFor(clientId)
    const first = await (
      await app.request(form({ grant_type: 'authorization_code', code, code_verifier: VERIFIER }))
    ).json()

    const refreshed = await app.request(
      form({ grant_type: 'refresh_token', refresh_token: first.refresh_token }),
    )
    expect(refreshed.status).toBe(200)
    expect((await refreshed.json()).refresh_token).not.toBe(first.refresh_token)

    const replayed = await app.request(
      form({ grant_type: 'refresh_token', refresh_token: first.refresh_token }),
    )
    expect(replayed.status).toBe(400)
  })

  it('refuses a grant type we do not support', async () => {
    const response = await app.request(form({ grant_type: 'client_credentials' }))
    expect((await response.json()).error).toBe('unsupported_grant_type')
  })
})

describe('revocation', () => {
  /** RFC 7009: a caller must not learn which strings are real tokens. */
  it('answers 200 for a token that never existed', async () => {
    const response = await app.request(
      new Request('http://mcp.test/revoke', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ token: 'never-issued' }).toString(),
      }),
    )
    expect(response.status).toBe(200)
  })
})
