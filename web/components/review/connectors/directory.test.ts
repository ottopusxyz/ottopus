import { describe, expect, it } from 'vitest'
import { fetchDirectory, pairingLink } from './directory'

function answering(body: unknown, status = 200) {
  const asked: string[] = []
  const fetcher = (async (url: string) => {
    asked.push(url)
    return { ok: status >= 200 && status < 300, status, json: async () => body } as Response
  }) as unknown as typeof fetch
  return { asked, fetcher }
}

const listing = (over: Record<string, unknown>) => ({
  id: 'a',
  name: 'Alpha',
  image_id: 'img-1',
  rdns: null,
  chains: ['eip155:1'],
  mobile: { native: 'alpha://', universal: 'https://alpha.example/app' },
  ...over,
})

describe('fetchDirectory', () => {
  it('asks the registry with the project id, the page and the search', async () => {
    const { asked, fetcher } = answering({ listings: {}, total: 0 })
    await fetchDirectory({ projectId: 'p1', search: ' rain ', page: 2, fetch: fetcher })
    const url = new URL(asked[0]!)
    expect(url.origin + url.pathname).toBe('https://explorer-api.walletconnect.com/v3/wallets')
    expect(Object.fromEntries(url.searchParams)).toEqual({ projectId: 'p1', entries: '40', page: '2', sdks: 'sign_v2', search: 'rain' })
  })

  it('keeps EVM wallets and builds the logo on the registry’s own host', async () => {
    const { fetcher } = answering({
      listings: {
        a: listing({}),
        b: listing({ id: 'b', name: 'Sol only', chains: ['solana:mainnet'] }),
        c: listing({ id: 'c', name: 'No chains said', chains: [] }),
        d: { id: 'd' },
      },
      total: 4,
    })
    const page = await fetchDirectory({ projectId: 'p1', fetch: fetcher })
    expect(page.total).toBe(4)
    expect(page.wallets.map((w) => w.name)).toEqual(['Alpha', 'No chains said'])
    expect(page.wallets[0]!.icon).toBe('https://explorer-api.walletconnect.com/v3/logo/md/img-1?projectId=p1')
  })

  it('drops links that could not open an app, and logos that are not an id', async () => {
    const { fetcher } = answering({
      listings: {
        a: listing({ image_id: '../x', mobile: { native: 'javascript:alert(1)', universal: 'http://plain.example' } }),
        b: listing({ id: 'b', mobile: { native: 'https://not-a-scheme.example', universal: null } }),
      },
    })
    const { wallets } = await fetchDirectory({ projectId: 'p1', fetch: fetcher })
    expect(wallets.map((w) => [w.icon, w.native, w.universal])).toEqual([
      [null, null, null],
      ['https://explorer-api.walletconnect.com/v3/logo/md/img-1?projectId=p1', null, null],
    ])
  })

  it('says so when the registry refuses', async () => {
    const { fetcher } = answering({}, 401)
    await expect(fetchDirectory({ projectId: 'bad', fetch: fetcher })).rejects.toThrow(/401/)
  })
})

describe('pairingLink', () => {
  const uri = 'wc:abc@2?relay-protocol=irn&symKey=k'
  it('prefers the https link and carries the code encoded', () => {
    expect(pairingLink({ native: 'alpha://', universal: 'https://alpha.example/app' }, uri)).toBe(
      `https://alpha.example/app/wc?uri=${encodeURIComponent(uri)}`,
    )
  })
  it('falls back to the app’s own scheme', () => {
    expect(pairingLink({ native: 'alpha://', universal: null }, uri)).toBe(`alpha://wc?uri=${encodeURIComponent(uri)}`)
  })
  it('is null for a wallet with no link', () => {
    expect(pairingLink({ native: null, universal: null }, uri)).toBeNull()
  })
})
