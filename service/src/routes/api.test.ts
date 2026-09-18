import { describe, expect, it } from 'vitest'
import { config } from '../config.js'
import { apiApp } from './api.js'

/**
 * The browser calls this surface cross-origin always — ottopus.xyz to
 * api.ottopus.xyz in production, :3000 to :8787 locally — so CORS is not a
 * nicety here, it is the difference between the app working and not.
 *
 * Only preflights and unauthenticated calls are exercised. Both answer before
 * anything touches the database, which keeps these tests offline.
 */

const WEB = 'http://localhost:3000'
const STRANGER = 'https://evil.example'

const preflight = (origin: string, headers = 'authorization,x-privy-identity-token') =>
  apiApp.request('/session', {
    method: 'OPTIONS',
    headers: {
      Origin: origin,
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': headers,
    },
  })

describe('preflight', () => {
  it('answers instead of 404ing', async () => {
    const res = await preflight(WEB)
    expect(res.status).toBe(204)
  })

  it('echoes the calling origin rather than a wildcard', async () => {
    const res = await preflight(WEB)
    expect(res.headers.get('access-control-allow-origin')).toBe(WEB)
  })

  /**
   * The one that actually broke: a custom request header turns every call into
   * a preflighted one, and a browser will not send a header the preflight did
   * not name.
   */
  it('allows the identity token header', async () => {
    const res = await preflight(WEB)
    expect(res.headers.get('access-control-allow-headers')?.toLowerCase()).toContain(
      'x-privy-identity-token',
    )
  })

  it('allows the methods the app uses', async () => {
    const allowed = (await preflight(WEB)).headers.get('access-control-allow-methods') ?? ''
    for (const method of ['GET', 'POST']) expect(allowed).toContain(method)
  })

  it('tells caches the answer depends on who asked', async () => {
    const vary = (await preflight(WEB)).headers.get('vary')?.toLowerCase() ?? ''
    expect(vary).toContain('origin')
  })

  it('refuses an origin that is not ours', async () => {
    const res = await preflight(STRANGER)
    expect(res.headers.get('access-control-allow-origin')).toBeNull()
  })
})

describe('actual requests', () => {
  it('carries the header on a real response, not just the preflight', async () => {
    const res = await apiApp.request('/session', { method: 'POST', headers: { Origin: WEB } })
    expect(res.status).toBe(401)
    expect(res.headers.get('access-control-allow-origin')).toBe(WEB)
  })

  /** Without this a browser reads the 401 for a site that should not see it. */
  it('gives a stranger no origin header even on an error', async () => {
    const res = await apiApp.request('/session', { method: 'POST', headers: { Origin: STRANGER } })
    expect(res.headers.get('access-control-allow-origin')).toBeNull()
  })

  it('leaves health open to same-origin callers', async () => {
    const res = await apiApp.request('/health')
    expect(res.status).toBe(200)
  })
})

/**
 * The web app used to derive this by swapping /api for /mcp on the API base,
 * which is right on one origin and wrong across subdomains — it produced
 * https://api.ottopus.xyz/mcp, a 404. The address someone pastes has to be the
 * string the service binds tokens to, so the service is the one that says it.
 */
describe('the address to paste into an agent', () => {
  it('is the same string the service uses as its own identity', async () => {
    const res = await apiApp.request('/meta')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ mcpUrl: config.mcpUrl })
  })

  it('needs no session — it is the value already in the public metadata', async () => {
    const res = await apiApp.request('/meta')
    expect(res.status).not.toBe(401)
    expect(res.status).not.toBe(503)
  })

  it('says nothing else, so a new secret cannot be added here by accident', async () => {
    const body = (await (await apiApp.request('/meta')).json()) as Record<string, unknown>
    expect(Object.keys(body)).toEqual(['mcpUrl'])
  })
})
