import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PortfolioError } from '../connectors/portfolio/types.js'
import { apiErrorHandler } from './errors.js'

/** A tiny app with one route per way an error can escape, and the real handler on it. */
function app() {
  const a = new Hono()
  a.onError(apiErrorHandler)
  a.get('/hono', () => { throw new HTTPException(429, { message: 'slow down' }) })
  a.get('/provider', () => { throw new PortfolioError('unavailable', 'zerion did not answer') })
  a.get('/unconfigured', () => { throw new PortfolioError('not_configured', 'ZERION_API_KEY is not set') })
  a.get('/bug', () => { throw new TypeError('cannot read properties of undefined') })
  // A sub-app mounted with route(): the handler must reach errors from there too.
  const sub = new Hono()
  sub.get('/deep', () => { throw new PortfolioError('unavailable', 'nope') })
  a.route('/mounted', sub)
  return a
}

describe('the web surface’s error handler', () => {
  afterEach(() => vi.restoreAllMocks())

  it('lets a Hono exception keep its own status', async () => {
    const res = await app().request('/hono')
    expect(res.status).toBe(429)
  })

  it('answers a provider that would not answer with a 502 the page has a state for', async () => {
    const res = await app().request('/provider')
    expect(res.status).toBe(502)
    expect(await res.json()).toEqual({ error: 'provider_unavailable', code: 'unavailable' })
  })

  it('keeps 503 for a provider that is not configured, which the page words differently', async () => {
    const res = await app().request('/unconfigured')
    expect(res.status).toBe(503)
    expect(await res.json()).toMatchObject({ code: 'not_configured' })
  })

  it('reaches errors thrown inside a mounted sub-app', async () => {
    const res = await app().request('/mounted/deep')
    expect(res.status).toBe(502)
  })

  /** "I got a 500" has to be turnable into a stack in one grep. */
  it('gives a bug a request id, logs the stack under the same id, and never puts the stack in the body', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await app().request('/bug')
    expect(res.status).toBe(500)
    const body = (await res.json()) as { error: string; requestId: string }
    expect(body.error).toBe('internal')
    expect(body.requestId).toMatch(/^[0-9a-f-]{36}$/)
    expect(JSON.stringify(body)).not.toMatch(/TypeError|at /)

    expect(logged).toHaveBeenCalledTimes(1)
    const line = JSON.parse(String(logged.mock.calls[0]![0])) as Record<string, string>
    expect(line).toMatchObject({ level: 'error', msg: 'unhandled', requestId: body.requestId, method: 'GET', path: '/bug' })
    expect(line.err).toMatch(/cannot read properties/)
    expect(line.stack).toMatch(/TypeError/)
  })
})
