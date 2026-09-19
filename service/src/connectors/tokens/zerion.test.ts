import { describe, expect, it } from 'vitest'
import { zerionTokens } from './zerion.js'

const BASE = 'eip155:8453'
const USDC = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913'
const DEGEN = '0x4ed4e862860bed51a9570b96d89af5e1b0efefed'

const CHAINS = {
  data: [
    { id: 'base', attributes: { name: 'Base', external_id: '0x2105' } },
    { id: 'ethereum', attributes: { name: 'Ethereum', external_id: '0x1' } },
  ],
}

const fungible = (over: Record<string, unknown> = {}) => ({
  id: 'degen',
  attributes: {
    name: 'Degen',
    symbol: 'DEGEN',
    flags: { verified: true },
    implementations: [
      { chain_id: 'base', address: DEGEN, decimals: 18 },
      { chain_id: 'ethereum', address: '0x1111111111111111111111111111111111111111', decimals: 9 },
    ],
    market_data: { price: 0.001044 },
    icon: { url: 'https://cdn.zerion/degen.png' },
    ...over,
  },
})

/** A fake Zerion that records every path it was asked for. */
function server(routes: Record<string, { status?: number; body?: unknown }>) {
  const seen: string[] = []
  const doFetch = (async (url: unknown) => {
    const path = String(url).replace('https://api.zerion.io/v1', '')
    seen.push(path)
    const key = Object.keys(routes).find((k) => path.startsWith(k))
    const route = key ? routes[key]! : { status: 404 }
    return new Response(route.body === undefined ? '{}' : JSON.stringify(route.body), {
      status: route.status ?? 200,
      headers: { 'content-type': 'application/json' },
    })
  }) as unknown as typeof fetch
  return { seen, tokens: zerionTokens({ apiKey: 'k', fetch: doFetch, now: () => 1_000 }) }
}

const withChains = (routes: Record<string, { status?: number; body?: unknown }>) =>
  server({ '/chains/': { body: CHAINS }, ...routes })

describe('the token registry', () => {
  it('searches by symbol on the provider’s own chain slug, biggest first', async () => {
    const { seen, tokens } = withChains({ '/fungibles/?': { body: { data: [fungible()] } } })
    const found = await tokens.find(BASE, 'degen')

    expect(found).toEqual({
      assetId: `${BASE}/erc20:${DEGEN}`,
      symbol: 'DEGEN',
      name: 'Degen',
      decimals: 18,
      iconUrl: 'https://cdn.zerion/degen.png',
      priceUsd: 0.001044,
      verified: true,
    })
    const query = new URLSearchParams(seen.find((p) => p.startsWith('/fungibles/?'))!.split('?')[1])
    expect(query.get('filter[search_query]')).toBe('degen')
    expect(query.get('filter[implementation_chain_id]')).toBe('base')
    // A symbol matches its own clones; market cap puts the real one on top.
    expect(query.get('sort')).toBe('-market_data.market_cap')
  })

  /**
   * A fungible spans chains, and only the implementation for the chain being
   * asked about carries a usable address and decimals. Taking the first would
   * have returned Ethereum's address with 9 decimals for a Base lookup.
   */
  it('takes the implementation for the chain asked about, not the first one', async () => {
    const { tokens } = withChains({ '/fungibles/?': { body: { data: [fungible()] } } })
    expect(await tokens.find(BASE, 'degen')).toMatchObject({ assetId: `${BASE}/erc20:${DEGEN}`, decimals: 18 })
  })

  it('has nothing to say when the fungible is not on that chain at all', async () => {
    const only = fungible({ implementations: [{ chain_id: 'ethereum', address: USDC, decimals: 6 }] })
    const { tokens } = withChains({ '/fungibles/?': { body: { data: [only] } } })
    expect(await tokens.find(BASE, 'degen')).toBeNull()
  })

  it('looks an address up directly rather than searching for it', async () => {
    const { seen, tokens } = withChains({ '/fungibles/by-implementation': { body: { data: fungible() } } })
    await tokens.find(BASE, DEGEN)
    expect(seen.some((p) => p.startsWith('/fungibles/by-implementation'))).toBe(true)
    expect(seen.some((p) => p.startsWith('/fungibles/?'))).toBe(false)
    expect(decodeURIComponent(seen.at(-1)!)).toContain(`implementation=base:${DEGEN}`)
  })

  it('resolves an asset id through the same lookup', async () => {
    const { tokens } = withChains({ '/fungibles/by-implementation': { body: { data: fungible() } } })
    expect(await tokens.byAssetId(`${BASE}/erc20:${DEGEN}`)).toMatchObject({ symbol: 'DEGEN', decimals: 18 })
  })

  /** ETH on Base is not worth a round trip, and a provider could name it wrong. */
  describe('the chain’s own currency', () => {
    it('is answered without asking anybody', async () => {
      const { seen, tokens } = withChains({})
      expect(await tokens.find(BASE, 'ETH')).toMatchObject({ assetId: `${BASE}/slip44:60`, symbol: 'ETH', decimals: 18 })
      expect(await tokens.byAssetId(`${BASE}/slip44:60`)).toMatchObject({ symbol: 'ETH' })
      expect(await tokens.find('eip155:56', 'BNB')).toMatchObject({ assetId: 'eip155:56/slip44:714', symbol: 'BNB' })
      expect(seen).toEqual([])
    })

    it('is what the zero address means', async () => {
      const { seen, tokens } = withChains({})
      expect(await tokens.find(BASE, '0x0000000000000000000000000000000000000000')).toMatchObject({ symbol: 'ETH' })
      expect(seen).toEqual([])
    })

    /** Zerion writes the native implementation's address as an empty string here. */
    it('is not built out of an addressless implementation', async () => {
      const bare = fungible({ implementations: [{ chain_id: 'base', address: '', decimals: 18 }] })
      const { tokens } = withChains({ '/fungibles/?': { body: { data: [bare] } } })
      expect(await tokens.find(BASE, 'something')).toBeNull()
    })
  })

  describe('when it cannot answer', () => {
    it('reads a 404 as no such token, and remembers that', async () => {
      const { seen, tokens } = withChains({ '/fungibles/?': { status: 404 } })
      expect(await tokens.find(BASE, 'nope')).toBeNull()
      expect(await tokens.find(BASE, 'nope')).toBeNull()
      expect(seen.filter((p) => p.startsWith('/fungibles/?'))).toHaveLength(1)
    })

    /** A provider having a bad minute is not evidence that a token does not exist. */
    it('does not remember a failure as an absence', async () => {
      const { seen, tokens } = withChains({ '/fungibles/?': { status: 500, body: {} } })
      expect(await tokens.find(BASE, 'degen')).toBeNull()
      expect(await tokens.find(BASE, 'degen')).toBeNull()
      expect(seen.filter((p) => p.startsWith('/fungibles/?'))).toHaveLength(2)
    })

    it('answers nothing for a chain the provider does not list', async () => {
      const { tokens } = withChains({ '/fungibles/?': { body: { data: [fungible()] } } })
      // Arbitrum is a chain we know and this fake provider does not.
      expect(await tokens.find('eip155:42161', 'degen')).toBeNull()
    })

    it('answers nothing for a chain that is not EVM, or an id that is not one', async () => {
      const { tokens } = withChains({})
      expect(await tokens.find('solana:mainnet', 'SOL')).toBeNull()
      expect(await tokens.find('not-a-chain', 'ETH')).toBeNull()
      expect(await tokens.byAssetId('not-an-asset')).toBeNull()
      expect(await tokens.find(BASE, '   ')).toBeNull()
    })

    it('answers nothing for an asset that is not a token', async () => {
      const { tokens } = withChains({})
      expect(await tokens.byAssetId(`${BASE}/erc721:${DEGEN}/1`)).toBeNull()
    })
  })

  it('asks once and remembers, because token metadata does not move', async () => {
    const { seen, tokens } = withChains({ '/fungibles/?': { body: { data: [fungible()] } } })
    await tokens.find(BASE, 'degen')
    await tokens.find(BASE, 'DEGEN')
    expect(seen.filter((p) => p.startsWith('/fungibles/?'))).toHaveLength(1)
  })
})
