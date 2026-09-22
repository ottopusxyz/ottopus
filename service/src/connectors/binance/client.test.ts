import { describe, expect, it } from 'vitest'
import { BinanceClient, BinanceError, serverTimeIn, signBinanceRequest } from './client.js'

const NOW = Date.parse('2026-09-21T11:42:00.000Z')
const CHAINS = '/api/v1/dex/aggregator/supported/chain'

/**
 * A fake vendor that records every request and answers from a script, one
 * answer per call, the last repeating. Answers are `Response`s so the
 * client's own parsing runs against them.
 */
function vendor(...answers: (() => Response)[]) {
  const seen: { url: URL; method: string; headers: Record<string, string>; body: string | null }[] = []
  let i = 0
  const doFetch = (async (url: unknown, init?: RequestInit) => {
    seen.push({
      url: new URL(String(url)),
      method: init?.method ?? 'GET',
      headers: Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>)),
      body: typeof init?.body === 'string' ? init.body : null,
    })
    const answer = answers[Math.min(i, answers.length - 1)]!
    i += 1
    return answer()
  }) as unknown as typeof fetch
  const slept: number[] = []
  const client = new BinanceClient({
    apiKey: 'test-key',
    secretKey: 'test-secret',
    fetch: doFetch,
    now: () => NOW,
    sleep: async (ms) => {
      slept.push(ms)
    },
  })
  return { seen, slept, client }
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => () =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } })

const ok = (data: unknown) => json({ code: 0, msg: 'success', data, success: true })

describe('the signature', () => {
  /**
   * Pinned to values computed by hand from the vendor's stated scheme:
   * base64(HMAC-SHA256(timestamp + METHOD + requestPath + body)), with the
   * `/build` prefix inside the signed path. If this vector breaks, so does
   * every request.
   */
  it('matches the vendor’s scheme for a GET', () => {
    expect(
      signBinanceRequest({
        secretKey: 'test-secret',
        timestamp: '2026-09-21T11:42:00.000Z',
        method: 'GET',
        requestPath: `/build${CHAINS}`,
        body: '',
      }),
    ).toBe('H143lzZEe+y/hqFiQ84barLYuE54qaEHyIXP2F1YQGg=')
  })

  it('signs the raw body of a POST', () => {
    expect(
      signBinanceRequest({
        secretKey: 'test-secret',
        timestamp: '2026-09-21T11:42:00.000Z',
        method: 'POST',
        requestPath: '/build/api/v1/dex/pre-transaction/simulate',
        body: '{"a":1}',
      }),
    ).toBe('7RPPWCRNxLBNbq45PwWiRKM2pAO29VUBLnnhDsV8cA4=')
  })
})

describe('a request', () => {
  it('carries the key, the timestamp, the signature and the widest window', async () => {
    const { seen, client } = vendor(ok([]))
    await client.get(CHAINS)
    const [req] = seen
    expect(req!.url.toString()).toBe(`https://web3.binance.com/build${CHAINS}`)
    expect(req!.headers['X-OC-APIKEY']).toBe('test-key')
    expect(req!.headers['X-OC-TIMESTAMP']).toBe('2026-09-21T11:42:00.000Z')
    expect(req!.headers['X-OC-RECV-WINDOW']).toBe('60000')
    expect(req!.headers['X-OC-SIGN']).toBe('H143lzZEe+y/hqFiQ84barLYuE54qaEHyIXP2F1YQGg=')
  })

  /**
   * The query string is built once and used twice — in the signature and on
   * the wire — because a signature over a differently encoded string is a
   * 401 with a message that blames the timestamp.
   */
  it('signs exactly the query string it sends', async () => {
    const { seen, client } = vendor(ok([]))
    await client.get('/api/v1/dex/market/rwa/price', {
      binanceChainId: 56,
      tokenContractAddresses: '0x02fc,0xa9ee',
      skip: undefined,
    })
    const [req] = seen
    const path = `${req!.url.pathname}${req!.url.search}`
    expect(path).toBe('/build/api/v1/dex/market/rwa/price?binanceChainId=56&tokenContractAddresses=0x02fc%2C0xa9ee')
    expect(req!.headers['X-OC-SIGN']).toBe(
      signBinanceRequest({
        secretKey: 'test-secret',
        timestamp: '2026-09-21T11:42:00.000Z',
        method: 'GET',
        requestPath: path,
        body: '',
      }),
    )
  })

  it('posts JSON and signs the same bytes', async () => {
    const { seen, client } = vendor(ok({ status: 'SUCCESS' }))
    await client.post('/api/v1/dex/pre-transaction/simulate', { binanceChainId: '56' })
    const [req] = seen
    expect(req!.method).toBe('POST')
    expect(req!.headers['content-type']).toBe('application/json')
    expect(req!.body).toBe('{"binanceChainId":"56"}')
    expect(req!.headers['X-OC-SIGN']).toBe(
      signBinanceRequest({
        secretKey: 'test-secret',
        timestamp: '2026-09-21T11:42:00.000Z',
        method: 'POST',
        requestPath: '/build/api/v1/dex/pre-transaction/simulate',
        body: '{"binanceChainId":"56"}',
      }),
    )
  })

  it('keeps the prefix from a custom base URL in the signed path', async () => {
    const seen: URL[] = []
    const client = new BinanceClient({
      apiKey: 'k',
      secretKey: 's',
      baseUrl: 'http://localhost:9999/build/',
      fetch: (async (url: unknown) => {
        seen.push(new URL(String(url)))
        return ok([])()
      }) as unknown as typeof fetch,
    })
    await client.get(CHAINS)
    expect(seen[0]!.toString()).toBe(`http://localhost:9999/build${CHAINS}`)
  })

  it('returns data and nothing else', async () => {
    const { client } = vendor(ok([{ binanceChainId: '56' }]))
    expect(await client.get(CHAINS)).toEqual([{ binanceChainId: '56' }])
  })
})

describe('the clock', () => {
  /**
   * The shape of the first real failure: an unsynced laptop, the vendor's
   * five-second default, and a 401 whose message names the time it wanted.
   */
  it('learns the offset from the refusal and asks once more', async () => {
    const { seen, client } = vendor(
      json({ code: 40103, msg: 'Timestamp outside recv_window. serverTime=2026-09-21T11:42:07.379942745Z', data: '' }, 401),
      ok([]),
    )
    await client.get(CHAINS)
    expect(seen).toHaveLength(2)
    expect(seen[1]!.headers['X-OC-TIMESTAMP']).toBe('2026-09-21T11:42:07.379Z')
    expect(client.clockOffset).toBe(7379)
  })

  it('keeps the learned offset for the next request', async () => {
    const { seen, client } = vendor(
      json({ code: 40103, msg: 'Timestamp outside recv_window. serverTime=2026-09-21T11:41:50.000Z', data: '' }, 401),
      ok([]),
    )
    await client.get(CHAINS)
    await client.get(CHAINS)
    expect(seen).toHaveLength(3)
    expect(seen[2]!.headers['X-OC-TIMESTAMP']).toBe('2026-09-21T11:41:50.000Z')
  })

  it('gives up after one retry, as a key problem rather than a loop', async () => {
    const { seen, client } = vendor(
      json({ code: 40103, msg: 'Timestamp outside recv_window. serverTime=2026-09-21T11:42:07.000Z', data: '' }, 401),
    )
    await expect(client.get(CHAINS)).rejects.toMatchObject({ code: 'not_configured', vendorCode: 40103 })
    expect(seen).toHaveLength(2)
  })

  it('reads the server time out of the message', () => {
    expect(serverTimeIn('Timestamp outside recv_window. serverTime=2026-09-21T11:42:00.379942745Z')).toBe(
      Date.parse('2026-09-21T11:42:00.379Z'),
    )
    expect(serverTimeIn('Timestamp outside recv_window.')).toBeNull()
    expect(serverTimeIn(undefined)).toBeNull()
  })
})

describe('what the vendor says', () => {
  it('is a rejection with the vendor’s code when the envelope says no', async () => {
    const { client } = vendor(json({ code: 40468, msg: 'CONFLICT_REFERRER_PARAMS', data: null }))
    const err = await client.get(CHAINS).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(BinanceError)
    expect(err).toMatchObject({ code: 'rejected', vendorCode: 40468 })
    expect((err as Error).message).toContain('CONFLICT_REFERRER_PARAMS')
  })

  it('waits once on a rate limit, then reports it', async () => {
    const { seen, slept, client } = vendor(json({}, 429, { 'retry-after': '1' }), ok([]))
    await client.get(CHAINS)
    expect(slept).toEqual([1000])
    expect(seen).toHaveLength(2)

    const again = vendor(json({}, 429, { 'retry-after': '1' }))
    await expect(again.client.get(CHAINS)).rejects.toMatchObject({ code: 'rate_limited' })
    expect(again.seen).toHaveLength(2)
  })

  it('does not wait on a rate limit longer than the request is worth', async () => {
    const { slept, client } = vendor(json({}, 429, { 'retry-after': '30' }))
    await expect(client.get(CHAINS)).rejects.toMatchObject({ code: 'rate_limited' })
    expect(slept).toEqual([])
  })

  it('is a key problem on 401 and 403', async () => {
    const { client } = vendor(json({ code: 40101, msg: 'invalid api key' }, 401))
    await expect(client.get(CHAINS)).rejects.toMatchObject({ code: 'not_configured' })
  })

  it('is unavailable on a 5xx, on a non-JSON body, and when nothing answers', async () => {
    await expect(vendor(json({ code: 50000, msg: 'boom' }, 503)).client.get(CHAINS)).rejects.toMatchObject({ code: 'unavailable' })
    await expect(vendor(() => new Response('<html/>', { status: 200 })).client.get(CHAINS)).rejects.toMatchObject({
      code: 'unavailable',
    })
    await expect(
      vendor(() => {
        throw new Error('ECONNREFUSED')
      }).client.get(CHAINS),
    ).rejects.toMatchObject({ code: 'unavailable' })
  })

  it('refuses to exist without both halves of the credential', () => {
    expect(() => new BinanceClient({ apiKey: 'k', secretKey: '' })).toThrow(BinanceError)
    expect(() => new BinanceClient({ apiKey: '', secretKey: 's' })).toThrow(/BINANCE_WEB3_API_KEY/)
  })
})
