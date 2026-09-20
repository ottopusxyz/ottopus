import { describe, expect, it, vi } from 'vitest'
import { ChainMap } from '../portfolio/chains.js'
import { PortfolioError } from '../portfolio/types.js'
import { ZerionActivityConnector, toActivity, type ZerionTransaction } from './zerion.js'

const CHAINS = new ChainMap([
  { id: 'base', name: 'Base', externalId: '0x2105' },
  { id: 'arbitrum', name: 'Arbitrum', externalId: '0xa4b1' },
  { id: 'solana', name: 'Solana', externalId: null },
])

const ME = '0x958543756a4c7ac6fb361f0efbfecd98e4d297db'
const LIFI = '0x1231deb6f5749ef6ce6943a275a1d3e7486f4eae'

const USDC = { id: 'usdc', name: 'USDC', symbol: 'USDC', icon: { url: 'https://cdn/usdc.png' }, flags: { verified: true } }
const ETH = { id: 'eth', name: 'Ethereum', symbol: 'ETH', icon: { url: 'https://cdn/eth.png' }, flags: { verified: true } }

/** The trade Zerion returned on Sep 11, trimmed to what the reader looks at. */
function trade(overrides: Record<string, unknown> = {}, chain = 'arbitrum'): ZerionTransaction {
  return {
    id: 'a2fa5101',
    attributes: {
      operation_type: 'trade',
      hash: '0x0b68',
      mined_at_block: 504044310,
      mined_at: '2026-09-11T12:06:51Z',
      sent_from: ME,
      sent_to: LIFI,
      status: 'confirmed',
      fee: { fungible_info: ETH, quantity: { int: '6180043004000', decimals: 18 }, value: 0.0152 },
      transfers: [
        { fungible_info: USDC, direction: 'in', quantity: { int: '499221', decimals: 6 }, value: 0.4986, price: 0.9988, sender: LIFI, recipient: ME },
        { fungible_info: ETH, direction: 'out', quantity: { int: '204000000000000', decimals: 18 }, value: 0.5014, price: 2457.84, sender: ME, recipient: LIFI },
      ],
      approvals: [],
      application_metadata: { name: 'LI.FI', icon: { url: 'https://icons/lifi.jpg' }, contract_address: LIFI, method: { id: '0x736eac0b', name: '' } },
      flags: { is_trash: false },
      ...overrides,
    },
    relationships: { chain: { data: { id: chain } } },
  }
}

describe('reading a transaction', () => {
  it('names the chain in CAIP-2 and keeps both legs of a trade', () => {
    const out = toActivity(trade(), CHAINS)
    expect(out?.chainId).toBe('eip155:42161')
    expect(out?.kind).toBe('trade')
    expect(out?.transfers.map((t) => `${t.direction} ${t.amount}`)).toEqual(['in 499221', 'out 204000000000000'])
    expect(out?.fee).toEqual({ symbol: 'ETH', amount: '6180043004000', decimals: 18, value: 0.0152 })
    // An empty method name is no method, not a method called "".
    expect(out?.app).toEqual({ name: 'LI.FI', iconUrl: 'https://icons/lifi.jpg', contract: LIFI, method: null })
  })

  it('drops a row on a chain it cannot name', () => {
    expect(toActivity(trade({}, 'solana'), CHAINS)).toBeNull()
    expect(toActivity(trade({}, 'hyperliquid'), CHAINS)).toBeNull()
  })

  it('reads an approval as a spender and an amount, and knows unlimited when it sees it', () => {
    const spender = '0x03a520b32c04bf3beef7beb72e919cf822ed34f1'
    const out = toActivity(
      trade({
        operation_type: 'approve',
        transfers: [],
        approvals: [{ fungible_info: USDC, quantity: { int: '300000', decimals: 6 }, sender: spender }],
      }),
      CHAINS,
    )
    expect(out?.approvals).toEqual([
      { asset: { kind: 'fungible', symbol: 'USDC', name: 'USDC', iconUrl: 'https://cdn/usdc.png', verified: true }, amount: '300000', decimals: 6, unlimited: false, spender },
    ])

    const max = ((1n << 256n) - 1n).toString()
    const unlimited = toActivity(
      trade({ operation_type: 'approve', transfers: [], approvals: [{ fungible_info: USDC, quantity: { int: max, decimals: 6 }, sender: spender }] }),
      CHAINS,
    )
    expect(unlimited?.approvals[0]?.unlimited).toBe(true)
  })

  it('keeps an NFT leg by name and image', () => {
    const out = toActivity(
      trade({
        operation_type: 'deposit',
        transfers: [
          {
            nft_info: { contract_address: '0x03a5', token_id: '5977045', name: 'Uniswap - 0.05% - USDC/WETH', content: { preview: { url: 'https://img/1' } } },
            direction: 'in',
            quantity: { int: '1', decimals: 0 },
            value: null,
            price: null,
            sender: '0x0000000000000000000000000000000000000000',
            recipient: ME,
          },
        ],
      }),
      CHAINS,
    )
    expect(out?.transfers[0]?.asset).toEqual({ kind: 'nft', name: 'Uniswap - 0.05% - USDC/WETH', imageUrl: 'https://img/1', contract: '0x03a5', tokenId: '5977045' })
    expect(out?.transfers[0]?.value).toBeNull()
  })

  it('reads a kind it has no word for as a contract call, and a status it does not know as confirmed', () => {
    const out = toActivity(trade({ operation_type: 'teleport', status: 'wat' }), CHAINS)
    expect(out?.kind).toBe('execute')
    expect(out?.status).toBe('confirmed')
  })

  it('drops a row without a hash or a time', () => {
    expect(toActivity(trade({ hash: undefined }), CHAINS)).toBeNull()
    expect(toActivity(trade({ mined_at: undefined }), CHAINS)).toBeNull()
  })
})

describe('asking zerion', () => {
  function reader(handler: (url: URL) => unknown) {
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input : input.url)
      if (url.pathname.endsWith('/chains/')) {
        return new Response(JSON.stringify({ data: [{ id: 'base', attributes: { name: 'Base', external_id: '0x2105' } }] }))
      }
      return new Response(JSON.stringify(handler(url)))
    }) as unknown as typeof fetch
    return { connector: new ZerionActivityConnector({ apiKey: 'k', fetch: fetchImpl, timeoutMs: 500 }), fetchImpl }
  }

  it('sends the filters and a bound one second past the instant asked for', async () => {
    const urls: URL[] = []
    const { connector } = reader((url) => {
      urls.push(url)
      return { data: [trade({}, 'base')], links: { next: 'https://api/next' } }
    })
    const page = await connector.transactionsFor(
      { namespace: 'eip155', address: ME },
      { kinds: ['trade', 'send'], chainId: 'eip155:8453', before: '2026-09-11T12:06:51Z', size: 25 },
    )
    const query = urls.at(-1)!.searchParams
    expect(query.get('filter[operation_types]')).toBe('trade,send')
    expect(query.get('filter[chain_ids]')).toBe('base')
    expect(query.get('filter[max_mined_at]')).toBe(String(Date.parse('2026-09-11T12:06:51Z') + 1000))
    expect(query.get('filter[trash]')).toBe('only_non_trash')
    expect(query.get('page[size]')).toBe('25')
    expect(page.items).toHaveLength(1)
    expect(page.more).toBe(true)
  })

  it('answers an unknown chain with nothing rather than asking', async () => {
    const { connector, fetchImpl } = reader(() => ({ data: [] }))
    const page = await connector.transactionsFor({ namespace: 'eip155', address: ME }, { chainId: 'eip155:99999', size: 5 })
    expect(page).toEqual({ items: [], more: false })
    // The chain list, and nothing else.
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('refuses an account that is not eip155', async () => {
    const { connector } = reader(() => ({ data: [] }))
    await expect(connector.transactionsFor({ namespace: 'solana', address: 'abc' }, { size: 5 })).rejects.toThrow(PortfolioError)
  })
})
