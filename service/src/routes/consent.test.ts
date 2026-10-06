import { PGlite } from '@electric-sql/pglite'
import { drizzle } from 'drizzle-orm/pglite'
import type { MiddlewareHandler } from 'hono'
import { beforeAll, describe, expect, it } from 'vitest'
import { userIdForDid } from '../auth/session.js'
import { migrationFiles, statementsIn } from '../db/migrate.js'
import * as schema from '../db/schema.js'
import { consumeAuthCode, createAuthRequest, registerClient, resourceUrl, type Scope } from '../oauth/index.js'
import { consentRoutes } from './consent.js'

/**
 * What the consent screen may add to a grant, and what it may not.
 *
 * The page is the one place a grant can come out different from what the agent
 * asked for, so the tests are about the edge of that: an opt-in scope is
 * granted only when its switch was on, whoever asked for it, and nothing else
 * can be added or removed at all.
 */
let db: ReturnType<typeof drizzle<typeof schema>>
let userId: string
let clientId: string

const REDIRECT = 'https://agent.example/callback'

/** Stands in for requireSession, as whoever `userId` is. */
const signedIn: MiddlewareHandler = async (c, next) => {
  c.set('userId', userId)
  await next()
}

const app = () => consentRoutes(db, signedIn)

beforeAll(async () => {
  const pg = await PGlite.create()
  await pg.exec(`create role anon; create role authenticated; create role service_role;`)
  for (const file of await migrationFiles(new URL('../../drizzle', import.meta.url).pathname)) {
    for (const stmt of await statementsIn(file)) await pg.exec(stmt)
  }
  db = drizzle(pg, { schema, casing: 'snake_case' })
  userId = await userIdForDid(db, 'did:privy:consent-owner')
  clientId = (await registerClient(db, { clientName: 'Test agent', redirectUris: [REDIRECT] })).clientId
}, 60_000)

const DEFAULTS: Scope[] = ['wallets:read', 'plans:read', 'plans:write']

async function parked(scopes: Scope[] = DEFAULTS): Promise<string> {
  const request = await createAuthRequest(db, {
    clientId,
    scopes,
    resource: resourceUrl(),
    redirectUri: REDIRECT,
    state: 'xyz',
    codeChallenge: 'challenge',
  })
  return request.id
}

/** Answer the request and come back with the scopes the minted code carries. */
async function scopesAfter(id: string, body: unknown): Promise<Scope[]> {
  const response = await app().request(`/${id}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  expect(response.status).toBe(200)
  const { redirectTo } = (await response.json()) as { redirectTo: string }
  const code = new URL(redirectTo).searchParams.get('code')!
  return (await consumeAuthCode(db, code))!.scopes
}

type Shown = { granted: { scope: string }[]; offered: { scope: string; requested: boolean }[] }

describe('GET /:id', () => {
  it('offers wallets:write as a switch that starts off when the agent did not ask for it', async () => {
    const response = await app().request(`/${await parked()}`)
    const body = (await response.json()) as Shown
    expect(body.granted.map((entry) => entry.scope)).not.toContain('wallets:write')
    expect(body.offered.map(({ scope, requested }) => ({ scope, requested }))).toEqual([
      { scope: 'wallets:write', requested: false },
    ])
  })

  /** Still a switch, never a plain row: asking only moves where it starts. */
  it('offers it as a switch that starts on when the agent named it', async () => {
    const response = await app().request(`/${await parked(['wallets:read', 'wallets:write'])}`)
    const body = (await response.json()) as Shown
    expect(body.granted.map((entry) => entry.scope)).toEqual(['wallets:read'])
    expect(body.offered.map(({ scope, requested }) => ({ scope, requested }))).toEqual([
      { scope: 'wallets:write', requested: true },
    ])
  })
})

describe('POST /:id', () => {
  it('grants only what was asked for when nothing is switched on', async () => {
    expect(await scopesAfter(await parked(), { approved: true })).toEqual(DEFAULTS)
  })

  it('adds wallets:write when the person switched it on', async () => {
    expect(await scopesAfter(await parked(), { approved: true, optIns: ['wallets:write'] })).toEqual([
      ...DEFAULTS,
      'wallets:write',
    ])
  })

  it('keeps wallets:write the agent asked for when the switch stayed on', async () => {
    const id = await parked([...DEFAULTS, 'wallets:write'])
    expect(await scopesAfter(id, { approved: true, optIns: ['wallets:write'] })).toEqual([
      ...DEFAULTS,
      'wallets:write',
    ])
  })

  it('drops wallets:write the agent asked for when the person switched it off', async () => {
    const id = await parked([...DEFAULTS, 'wallets:write'])
    expect(await scopesAfter(id, { approved: true, optIns: [] })).toEqual(DEFAULTS)
  })

  /** A page that says nothing about the switches has not switched one on. */
  it('drops wallets:write the agent asked for when the answer names no switches', async () => {
    const id = await parked([...DEFAULTS, 'wallets:write'])
    expect(await scopesAfter(id, { approved: true })).toEqual(DEFAULTS)
  })

  /** A default scope the agent left out stays out: the switch is for opt-ins only. */
  it('adds nothing that is not an opt-in scope', async () => {
    const id = await parked(['wallets:read'])
    expect(await scopesAfter(id, { approved: true, optIns: ['plans:write', 'wallets:sign'] })).toEqual([
      'wallets:read',
    ])
  })

  it('ignores a choice that is not a list', async () => {
    expect(await scopesAfter(await parked(), { approved: true, optIns: 'wallets:write' })).toEqual(DEFAULTS)
  })

  it('mints no code for a denial, whatever was switched on', async () => {
    const response = await app().request(`/${await parked()}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ approved: false, optIns: ['wallets:write'] }),
    })
    const redirect = new URL(((await response.json()) as { redirectTo: string }).redirectTo)
    expect(redirect.searchParams.get('error')).toBe('access_denied')
    expect(redirect.searchParams.has('code')).toBe(false)
  })
})
