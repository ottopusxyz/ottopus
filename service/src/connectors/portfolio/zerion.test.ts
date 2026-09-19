import { describe, expect, it, vi } from 'vitest'
import { cached } from './cache.js'
import { readPortfolio } from './aggregate.js'
import { ChainMap } from './chains.js'
import { PortfolioError } from './types.js'
import { ZerionPortfolioConnector, toPosition } from './zerion.js'

const CHAINS = new ChainMap([
  { id: 'base', name: 'Base', externalId: '0x2105' },
  { id: 'ethereum', name: 'Ethereum', externalId: '0x1' },
  { id: 'binance-smart-chain', name: 'BNB Chain', externalId: '0x38' },
  { id: 'solana', name: 'Solana', externalId: null },
])

const USDC = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913'

function position(overrides: Record<string, unknown> = {}, chain = 'base') {
  return {
    attributes: {
      quantity: { int: '1240000000', decimals: 6 },
      value: 1240,
      price: 1,
      changes: { absolute_1d: 0.4 },
      position_type: 'wallet',
      fungible_info: {
        name: 'USD Coin',
        symbol: 'USDC',
        icon: { url: 'https://cdn.zerion.io/usdc.png' },
        flags: { verified: true },
        implementations: [
          { chain_id: 'base', address: USDC, decimals: 6 },
          { chain_id: 'ethereum', address: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', decimals: 6 },
        ],
      },
      ...overrides,
    },
    relationships: { chain: { data: { id: chain } } },
  }
}

describe('naming a position in CAIP', () => {
  it('reads the implementation for the chain the position is on', () => {
    const out = toPosition(position(), CHAINS)
    expect(out?.assetId).toBe(`eip155:8453/erc20:${USDC}`)
    expect(out?.chainId).toBe('eip155:8453')
    expect(out?.amount).toBe('1240000000')
    expect(out?.asset.decimals).toBe(6)
  })

  it('names a native coin by its slip44 type, not by an empty address', () => {
    const native = position({
      fungible_info: {
        name: 'Ethereum',
        symbol: 'ETH',
        flags: { verified: true },
        // "" on the fungibles endpoints, null on the wallet ones. Both native.
        implementations: [
          { chain_id: 'base', address: null, decimals: 18 },
          { chain_id: 'ethereum', address: '', decimals: 18 },
        ],
      },
    })
    expect(toPosition(native, CHAINS)?.assetId).toBe('eip155:8453/slip44:60')
  })

  it('gives BNB, not ETH, for the native coin on BNB Chain', () => {
    const native = position(
      {
        fungible_info: {
          name: 'BNB',
          symbol: 'BNB',
          flags: { verified: true },
          implementations: [{ chain_id: 'binance-smart-chain', address: null, decimals: 18 }],
        },
      },
      'binance-smart-chain',
    )
    expect(toPosition(native, CHAINS)?.assetId).toBe('eip155:56/slip44:714')
  })

  it('drops a position on a chain it cannot name in CAIP-2', () => {
    expect(toPosition(position({}, 'solana'), CHAINS)).toBeNull()
    expect(toPosition(position({}, 'hyperevm'), CHAINS)).toBeNull()
  })

  it('drops a position whose fungible has no implementation on that chain', () => {
    const orphan = position({
      fungible_info: {
        symbol: 'WAT',
        flags: { verified: false },
        implementations: [{ chain_id: 'ethereum', address: USDC, decimals: 18 }],
      },
    })
    expect(toPosition(orphan, CHAINS)).toBeNull()
  })

  it('drops a position the provider says should not count', () => {
    expect(toPosition(position({ flags: { displayable: false } }), CHAINS)).toBeNull()
  })

  it('drops an amount that is not an integer string', () => {
    expect(toPosition(position({ quantity: { int: '12.4', decimals: 6 } }), CHAINS)).toBeNull()
    expect(toPosition(position({ quantity: { float: 12.4 } }), CHAINS)).toBeNull()
  })
})

describe('a loan is a magnitude, whichever sign the provider writes', () => {
  it('keeps a borrowed value positive and leaves the sign to the type', () => {
    const loan = toPosition(position({ position_type: 'loan', value: 500, changes: { absolute_1d: 2 } }), CHAINS)
    expect(loan?.positionType).toBe('loan')
    expect(loan?.value).toBe(500)
    expect(loan?.change1d).toBe(2)
  })

  it('turns an already-negative borrowed value positive', () => {
    const loan = toPosition(position({ position_type: 'loan', value: -500 }), CHAINS)
    expect(loan?.value).toBe(500)
  })
})

describe('what a protocol position carries', () => {
  const fluid = {
    position_type: 'deposit',
    protocol: 'Fluid',
    protocol_module: 'lending',
    name: 'Fluid Lending (#9468)',
    pool_address: '0x324c5dc1fc42c7a4d43d92df1eba58a54d13bf2d',
    group_id: '8fc6ac20',
    parent: null,
    application_metadata: {
      name: 'Fluid',
      icon: { url: 'https://protocol-icons.s3.amazonaws.com/icons/fluid.jpg' },
      url: 'https://fluid.instadapp.io',
    },
  }

  it('names the app, the module, the position and the pool', () => {
    const raw = position(fluid)
    raw.relationships = { ...raw.relationships, dapp: { data: { id: 'fluid' } } } as never
    expect(toPosition(raw, CHAINS)).toMatchObject({
      protocol: 'Fluid',
      protocolModule: 'lending',
      positionName: 'Fluid Lending (#9468)',
      dappId: 'fluid',
      dappIconUrl: 'https://protocol-icons.s3.amazonaws.com/icons/fluid.jpg',
      dappUrl: 'https://fluid.instadapp.io',
      poolAddress: '0x324c5dc1fc42c7a4d43d92df1eba58a54d13bf2d',
      parentId: null,
      groupId: '8fc6ac20',
    })
  })

  it('slugs the protocol name when the provider gives no dapp id', () => {
    expect(toPosition(position({ ...fluid, protocol: 'Aave V3' }), CHAINS)?.dappId).toBe('aave-v3')
  })

  it('carries a parent id without nesting anything', () => {
    expect(toPosition(position({ ...fluid, parent: 'farm-1' }), CHAINS)?.parentId).toBe('farm-1')
  })

  it('forgets a module it has no word for rather than dropping the position', () => {
    const out = toPosition(position({ ...fluid, protocol_module: 'perpetuals' }), CHAINS)
    expect(out?.protocolModule).toBeNull()
    expect(out?.positionType).toBe('deposit')
  })

  it('gives a wallet balance none of it', () => {
    expect(toPosition(position({ name: 'Asset' }), CHAINS)).toMatchObject({
      protocol: null,
      protocolModule: null,
      positionName: null,
      dappId: null,
      dappIconUrl: null,
      dappUrl: null,
      groupId: null,
    })
  })
})

describe('a protocol position never lands in the token list by guesswork', () => {
  it('keeps the type the provider gave', () => {
    expect(toPosition(position({ position_type: 'staked', protocol: 'Lido' }), CHAINS)?.positionType).toBe('staked')
  })

  it('calls an untyped position with a protocol deposited, not a wallet balance', () => {
    const out = toPosition(position({ position_type: null, protocol: 'Aave V3' }), CHAINS)
    expect(out?.positionType).toBe('deposit')
    expect(out?.protocol).toBe('Aave V3')
  })

  it('calls an untyped position with no protocol a wallet balance', () => {
    expect(toPosition(position({ position_type: null, protocol: null }), CHAINS)?.positionType).toBe('wallet')
  })

  it('does not trust a position type it has never heard of', () => {
    expect(toPosition(position({ position_type: 'wormhole', protocol: 'X' }), CHAINS)?.positionType).toBe('deposit')
  })
})

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  })
}

const CHAIN_BODY = {
  data: [
    { id: 'base', attributes: { name: 'Base', external_id: '0x2105' } },
    { id: 'ethereum', attributes: { name: 'Ethereum', external_id: '0x1' } },
  ],
}

const ACCOUNT = { namespace: 'eip155', address: '0xd8da6bf26964af9d7eed9e03e53415d37aa96045' }

function connector(fetchImpl: typeof globalThis.fetch) {
  return new ZerionPortfolioConnector({ apiKey: 'k', fetch: fetchImpl, timeoutMs: 500 })
}

describe('talking to zerion', () => {
  it('authenticates with the key as the username and an empty password', async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      const href = String(url)
      return jsonResponse(href.includes('/chains/') ? CHAIN_BODY : { data: [position()] })
    })

    await connector(fetchImpl as unknown as typeof globalThis.fetch).positionsFor(ACCOUNT)

    const headers = (fetchImpl.mock.calls[0]![1] as RequestInit).headers as Record<string, string>
    expect(headers['authorization']).toBe(`Basic ${Buffer.from('k:').toString('base64')}`)
  })

  it('asks for every position type, with spam already filtered out', async () => {
    const seen: string[] = []
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      seen.push(String(url))
      return jsonResponse(String(url).includes('/chains/') ? CHAIN_BODY : { data: [position()] })
    })

    const out = await connector(fetchImpl as unknown as typeof globalThis.fetch).positionsFor(ACCOUNT)

    const positionsUrl = seen.find((u) => u.includes('/positions/'))!
    expect(positionsUrl).toContain('filter%5Bpositions%5D=no_filter')
    expect(positionsUrl).toContain('filter%5Btrash%5D=only_non_trash')
    // No chain filter: the portfolio shows every chain Zerion tracks.
    expect(positionsUrl).not.toContain('chain_ids')
    expect(out).toHaveLength(1)
  })

  it('loads the chain list once, however many arms are read', async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request) =>
      jsonResponse(String(url).includes('/chains/') ? CHAIN_BODY : { data: [] }),
    )
    const zerion = connector(fetchImpl as unknown as typeof globalThis.fetch)

    await Promise.all([
      zerion.positionsFor(ACCOUNT),
      zerion.positionsFor(ACCOUNT),
      zerion.positionsFor(ACCOUNT),
    ])

    const chainCalls = fetchImpl.mock.calls.filter(([url]) => String(url).includes('/chains/'))
    expect(chainCalls).toHaveLength(1)
  })

  it('tells an untracked address apart from an outage', async () => {
    const fetchImpl = async (url: string | URL | Request) =>
      String(url).includes('/chains/')
        ? jsonResponse(CHAIN_BODY)
        : jsonResponse(
            { errors: [{ title: 'Malformed parameter was sent', detail: 'address 0xa0b8 is not trackable' }] },
            { status: 400 },
          )

    await expect(
      connector(fetchImpl as unknown as typeof globalThis.fetch).positionsFor(ACCOUNT),
    ).rejects.toMatchObject({ code: 'untracked_address' })
  })

  it('reports a bad key as a deployment problem, not the person’s', async () => {
    const fetchImpl = async () => jsonResponse({ errors: [] }, { status: 401 })
    await expect(
      connector(fetchImpl as unknown as typeof globalThis.fetch).positionsFor(ACCOUNT),
    ).rejects.toMatchObject({ code: 'not_configured' })
  })

  it('gives up on a rate limit that resets after the request is worth waiting for', async () => {
    const fetchImpl = async (url: string | URL | Request) =>
      String(url).includes('/chains/')
        ? jsonResponse(CHAIN_BODY)
        : jsonResponse({ errors: [] }, { status: 429, headers: { 'ratelimit-org-second-reset': '60' } })

    await expect(
      connector(fetchImpl as unknown as typeof globalThis.fetch).positionsFor(ACCOUNT),
    ).rejects.toMatchObject({ code: 'rate_limited' })
  })

  it('retries a short rate limit and succeeds', async () => {
    let positionCalls = 0
    const fetchImpl = async (url: string | URL | Request) => {
      if (String(url).includes('/chains/')) return jsonResponse(CHAIN_BODY)
      positionCalls++
      if (positionCalls === 1) {
        return jsonResponse({ errors: [] }, { status: 429, headers: { 'ratelimit-org-second-reset': '0' } })
      }
      return jsonResponse({ data: [position()] })
    }

    const out = await connector(fetchImpl as unknown as typeof globalThis.fetch).positionsFor(ACCOUNT)
    expect(out).toHaveLength(1)
    expect(positionCalls).toBe(2)
  })

  it('does not cache a failed chain load', async () => {
    // Held as a promise so eight arms share one load — which would also cache
    // the rejection, leaving one bad boot to poison every later request.
    let chainsDown = true
    const fetchImpl = async (url: string | URL | Request) => {
      if (String(url).includes('/chains/')) {
        return chainsDown ? jsonResponse({ errors: [] }, { status: 500 }) : jsonResponse(CHAIN_BODY)
      }
      return jsonResponse({ data: [position()] })
    }
    const zerion = connector(fetchImpl as unknown as typeof globalThis.fetch)

    await expect(zerion.positionsFor(ACCOUNT)).rejects.toBeInstanceOf(PortfolioError)

    chainsDown = false
    await expect(zerion.positionsFor(ACCOUNT)).resolves.toHaveLength(1)
  })

  it('refuses an account it cannot read rather than asking zerion about it', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(CHAIN_BODY))
    await expect(
      connector(fetchImpl as unknown as typeof globalThis.fetch).positionsFor({
        namespace: 'solana',
        address: '8BH9pjtgyZDC4iAQH5ZiYDZ1MDWC98xki2V8NzqqKW3K',
      }),
    ).rejects.toMatchObject({ code: 'unavailable' })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('needs a key at construction, not at the first request', () => {
    expect(() => new ZerionPortfolioConnector({ apiKey: '' })).toThrow(PortfolioError)
  })
})


describe('portfolio display metadata', () => {
  it('preserves the live fungible relationship ID shared across chains', () => {
    const raw = {
      ...position(),
      relationships: { chain: { data: { id: 'base' } }, fungible: { data: { id: 'usd-coin' } } },
    }
    expect(toPosition(raw, CHAINS)?.asset.familyId).toBe('zerion:usd-coin')
    expect(toPosition(position(), CHAINS)?.asset.familyId).toBeNull()
  })

  it('forwards network names and icons through the cache into the API response', async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request) => jsonResponse(
      String(url).includes('/chains/') ? {
        data: [{ id: 'base', attributes: { name: 'Base', external_id: '0x2105', icon: { url: 'https://chain-icons.s3.amazonaws.com/chainlist/8453' } } }],
      } : { data: [position()] },
    ))
    const wrapped = cached(connector(fetchImpl as unknown as typeof globalThis.fetch))
    for (let read = 0; read < 2; read++) {
      const portfolio = await readPortfolio(wrapped, [{ ...ACCOUNT, walletId: 'wallet' }])
      expect(portfolio.chains[0]).toMatchObject({
        chainId: 'eip155:8453', name: 'Base', iconUrl: 'https://chain-icons.s3.amazonaws.com/chainlist/8453',
      })
    }
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })
})
