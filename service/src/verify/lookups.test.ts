import { describe, expect, it } from 'vitest'
import { RpcReadError, httpLookups } from './lookups.js'

/**
 * The caching policy, with fetch answered from memory. Answers are kept;
 * failures are not — a Sourcify outage must not leave a contract unverified
 * until the process restarts.
 */
const CHAIN = 'eip155:8453'
const ADDR = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913'

function fetchScript(responses: Array<{ status: number; body?: unknown } | Error>) {
  let calls = 0
  const doFetch = (async () => {
    const next = responses[Math.min(calls, responses.length - 1)]!
    calls += 1
    if (next instanceof Error) throw next
    return new Response(next.body === undefined ? null : JSON.stringify(next.body), { status: next.status })
  }) as typeof fetch
  return { doFetch, calls: () => calls }
}

const found = { status: 200, body: { abi: [], match: 'exact_match', compilation: { name: 'Token' } } }

describe('sourcify cache', () => {
  it('asks once for a found contract', async () => {
    const { doFetch, calls } = fetchScript([found])
    const lookups = httpLookups({ fetch: doFetch })
    expect((await lookups.sourcify(CHAIN, ADDR))?.name).toBe('Token')
    await lookups.sourcify(CHAIN, ADDR)
    await lookups.sourcify(CHAIN, ADDR.toUpperCase())
    expect(calls()).toBe(1)
  })

  it('retries after an outage rather than remembering it', async () => {
    const { doFetch, calls } = fetchScript([{ status: 503 }, new Error('timeout'), found])
    const lookups = httpLookups({ fetch: doFetch })
    expect(await lookups.sourcify(CHAIN, ADDR)).toBeNull()
    expect(await lookups.sourcify(CHAIN, ADDR)).toBeNull()
    expect((await lookups.sourcify(CHAIN, ADDR))?.name).toBe('Token')
    expect(calls()).toBe(3)
  })

  it('remembers a definite 404, but not for as long as a found answer', async () => {
    let clock = 0
    const { doFetch, calls } = fetchScript([{ status: 404 }, found])
    const lookups = httpLookups({ fetch: doFetch, now: () => clock })
    expect(await lookups.sourcify(CHAIN, ADDR)).toBeNull()
    clock = 5 * 60_000
    expect(await lookups.sourcify(CHAIN, ADDR)).toBeNull()
    expect(calls()).toBe(1)
    clock = 11 * 60_000
    expect((await lookups.sourcify(CHAIN, ADDR))?.name).toBe('Token')
    expect(calls()).toBe(2)
  })

  it('shares one in-flight request between concurrent callers', async () => {
    const { doFetch, calls } = fetchScript([found])
    const lookups = httpLookups({ fetch: doFetch })
    await Promise.all([lookups.sourcify(CHAIN, ADDR), lookups.sourcify(CHAIN, ADDR)])
    expect(calls()).toBe(1)
  })
})

describe('4byte cache', () => {
  it('forgets a failure and keeps an answer', async () => {
    const { doFetch, calls } = fetchScript([
      new Error('down'),
      { status: 200, body: { results: [{ text_signature: 'transfer(address,uint256)' }] } },
    ])
    const lookups = httpLookups({ fetch: doFetch })
    expect(await lookups.fourByte('0xa9059cbb')).toEqual([])
    expect(await lookups.fourByte('0xa9059cbb')).toEqual(['transfer(address,uint256)'])
    expect(await lookups.fourByte('0xa9059cbb')).toEqual(['transfer(address,uint256)'])
    expect(calls()).toBe(2)
  })
})

describe('rpc errors', () => {
  /**
   * The template carries the API key. viem's error carries the URL. The two
   * must never meet in a log line, so the error that leaves here has the
   * chain and the provider's reason and nothing else.
   */
  it('never carries the provider URL or the key', async () => {
    const template = 'https://{network}.g.alchemy.com/v2/SECRET-KEY-VALUE'
    let asked = 0
    const doFetch = (async () => {
      asked += 1
      return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, error: { code: -32600, message: 'Must be authenticated!' } }), { status: 401 })
    }) as typeof fetch
    const lookups = httpLookups({ rpcUrlTemplate: template, fetch: doFetch, rpcTimeoutMs: 2_000 })
    const attempt = lookups.getCode('eip155:8453', '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913')
    await expect(attempt).rejects.toBeInstanceOf(RpcReadError)
    expect(asked).toBeGreaterThan(0)
    const message = await attempt.catch((e: Error) => e.message)
    expect(message).toMatch(/could not read eip155:8453/)
    expect(message).not.toContain('SECRET-KEY-VALUE')
    expect(message).not.toContain('alchemy.com')
  })
})
