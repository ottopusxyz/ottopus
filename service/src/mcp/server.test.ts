import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { describe, expect, it } from 'vitest'
import type { Portfolio } from '../connectors/portfolio/index.js'
import type { Arm } from '../wallets/index.js'
import { buildServer, type ToolDeps } from './server.js'

/**
 * The tool surface, over a real MCP client.
 *
 * In-memory transport rather than HTTP: what is being tested is what the server
 * offers and what it answers, and the Streamable HTTP layer is the SDK's code,
 * not ours. The HTTP half is covered where it is actually ours — the 401 and
 * the grant check in the OAuth tests.
 *
 * The reads are fakes. The tools take their data through ToolDeps precisely so
 * this file needs no database: what a tool says is a fact about the tool, not
 * about Postgres.
 */

const WALLETS: Arm[] = [
  {
    id: 'w1',
    namespace: 'eip155',
    address: '0xd8da6bf26964af9d7eed9e03e53415d37aa96045',
    label: 'Main',
    walletType: 'rabby',
    isWatchOnly: false,
    provedAt: '2026-09-05T00:00:00Z',
    createdAt: '2026-09-05T00:00:00Z',
  },
  {
    id: 'w2',
    namespace: 'eip155',
    address: '0x7922000000000000000000000000000000000f93',
    label: null,
    walletType: 'watch_only',
    isWatchOnly: true,
    provedAt: null,
    createdAt: '2026-09-06T00:00:00Z',
  },
]

const PORTFOLIO: Portfolio = {
  provider: 'zerion',
  currency: 'usd',
  asOf: '2026-09-09T10:00:00Z',
  total: 2000,
  gross: 2000,
  change1d: 12.4,
  arms: [
    { walletId: 'w1', address: WALLETS[0]!.address, status: 'ok', total: 2000, change1d: 12.4, positionCount: 1 },
    { walletId: 'w2', address: WALLETS[1]!.address, status: 'ok', total: 0, change1d: 0, positionCount: 0 },
  ],
  chains: [{ chainId: 'eip155:1', name: 'Ethereum', value: 2000, share: 1 }],
  assets: [
    {
      assetId: 'eip155:1/slip44:60',
      chainId: 'eip155:1',
      asset: { symbol: 'ETH', name: 'Ether', decimals: 18, iconUrl: null, verified: true },
      amount: '1258100000000000000',
      spendable: '1258100000000000000',
      value: 2000,
      price: 1589.7,
      change1d: 12.4,
      share: 1,
      holdings: [],
    },
  ],
}

const deps = (over: Partial<ToolDeps> = {}): ToolDeps => ({
  findUser: async (id) => ({ id, privyDid: 'did:privy:1', email: 'koshik@example.com', name: 'Koshik Raj' }),
  findAgent: async () => ({ clientName: 'Claude' }),
  listWallets: async () => WALLETS,
  readPortfolio: async () => PORTFOLIO,
  ...over,
})

async function connected(scopes = ['wallets:read', 'plans:read', 'plans:write'], over: Partial<ToolDeps> = {}) {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair()
  const server = buildServer({ userId: 'user-1', clientId: 'otc_test', scopes }, deps(over))
  const client = new Client({ name: 'test', version: '0' })
  await Promise.all([server.connect(serverSide), client.connect(clientSide)])
  return { client, server }
}

type Result = {
  content: { type: string; text: string }[]
  structuredContent?: Record<string, unknown>
  isError?: boolean
}

const call = async (client: Client, name: string, args: Record<string, unknown> = {}) =>
  (await client.callTool({ name, arguments: args })) as Result

describe('the tool surface', () => {
  /**
   * The product's whole promise, as a test. Tool calls create plans, never
   * transactions — so a tool that signs or broadcasts must never appear here,
   * and the way that stays true is a test that fails the moment one does.
   */
  it('exposes nothing that could sign or broadcast', async () => {
    const { client } = await connected()
    const { tools } = await client.listTools()

    const names = tools.map((tool) => tool.name)
    for (const forbidden of [
      'sign_message',
      'sign_transaction',
      'send_raw_transaction',
      'send_transaction',
      'broadcast',
    ]) {
      expect(names, `${forbidden} must never be exposed`).not.toContain(forbidden)
    }
    // Nothing that merely reads like one, either.
    expect(names.filter((name) => /^(sign|send|broadcast|submit)/.test(name))).toEqual([])
  })

  it('offers the three read tools, every one marked read-only', async () => {
    const { client } = await connected()
    const { tools } = await client.listTools()
    expect(tools.map((tool) => tool.name).sort()).toEqual(['get_portfolio', 'list_wallets', 'whoami'])
    for (const tool of tools) {
      expect(tool.annotations?.readOnlyHint, `${tool.name} is read-only`).toBe(true)
    }
  })
})

describe('whoami', () => {
  it('says who, in words a person would recognise as themselves', async () => {
    const { client } = await connected()
    const result = await call(client, 'whoami')
    const words = result.content[0]!.text

    expect(words).toContain('Signed in as Koshik Raj (koshik@example.com).')
    expect(words).toContain('Claude may: read your linked wallets; build and simulate requests; send you review links.')
    expect(words).toContain(
      'It can never sign, submit or move anything — Ottopus holds no key and cannot sign for you.',
    )
  })

  it('names only the permissions the grant carries', async () => {
    const { client } = await connected(['wallets:read'])
    const words = (await call(client, 'whoami')).content[0]!.text
    expect(words).toContain('Claude may: read your linked wallets.')
    expect(words).not.toContain('build and simulate')
  })

  it('keeps the ids in the structured copy, off the page', async () => {
    const { client } = await connected()
    const result = await call(client, 'whoami')
    expect(result.content[0]!.text).not.toContain('user-1')
    expect(result.content[0]!.text).not.toContain('otc_test')
    expect(result.structuredContent).toMatchObject({
      user: { id: 'user-1', name: 'Koshik Raj', email: 'koshik@example.com' },
      agent: { clientId: 'otc_test', name: 'Claude' },
    })
  })

  it('copes with a wallet-only account that has no name and no email', async () => {
    const { client } = await connected(undefined, {
      findUser: async (id) => ({ id, privyDid: 'did:privy:2', email: null, name: null }),
    })
    const words = (await call(client, 'whoami')).content[0]!.text
    expect(words).toContain('Signed in as an Ottopus account with no name or email on file.')
  })
})

describe('list_wallets', () => {
  it('lists each wallet with its name, address and whether it can sign', async () => {
    const { client } = await connected()
    const result = await call(client, 'list_wallets')
    const words = result.content[0]!.text

    expect(words).toContain('2 wallets linked:')
    expect(words).toContain('1. Main — rabby, 0xd8da…6045, can sign')
    expect(words).toContain('2. Watch Only — watch_only, 0x7922…0f93, watch only, cannot sign')
    expect(result.structuredContent).toMatchObject({
      wallets: [
        { id: 'w1', name: 'Main', canSign: true, watchOnly: false },
        { id: 'w2', name: null, canSign: false, watchOnly: true },
      ],
    })
  })

  it('refuses without wallets:read, and says what to change', async () => {
    const { client } = await connected(['plans:read'])
    const result = await call(client, 'list_wallets')
    expect(result.isError).toBe(true)
    expect(result.content[0]!.text).toContain('wallets:read')
    expect(result.content[0]!.text).toContain('Settings')
  })

  it('never hands the agent a private key, because there is none to hand', async () => {
    const { client } = await connected()
    const result = await call(client, 'list_wallets')
    expect(JSON.stringify(result)).not.toMatch(/private|seed|mnemonic|secret/i)
  })
})

describe('get_portfolio', () => {
  it('leads with the total and lists holdings highest value first', async () => {
    const { client } = await connected()
    const result = await call(client, 'get_portfolio')
    const words = result.content[0]!.text

    expect(words.split('\n')[0]).toBe('Total $2,000.00 across 2 wallets, +$12.40 today.')
    expect(words).toContain('- 1.2581 ETH on Ethereum — $2,000.00')
    expect(result.structuredContent).toMatchObject({ total: 2000, omitted: 0 })
  })

  it('honours the limit and counts what it cut', async () => {
    const { client } = await connected()
    const result = await call(client, 'get_portfolio', { limit: 1 })
    expect(result.structuredContent).toMatchObject({ omitted: 0 })
    expect((result.structuredContent as { assets: unknown[] }).assets).toHaveLength(1)
  })

  it('rejects a limit outside the bounds rather than guessing', async () => {
    const { client } = await connected()
    const result = await call(client, 'get_portfolio', { limit: 0 })
    expect(result.isError).toBe(true)
  })

  it('refuses without wallets:read', async () => {
    const { client } = await connected(['plans:write'])
    const result = await call(client, 'get_portfolio')
    expect(result.isError).toBe(true)
    expect(result.content[0]!.text).toContain('wallets:read')
  })

  it('says plainly when no balance provider is configured', async () => {
    const { client } = await connected(undefined, { readPortfolio: null })
    const result = await call(client, 'get_portfolio')
    expect(result.isError).toBe(true)
    expect(result.content[0]!.text).toContain('no portfolio provider is configured')
  })

  it('does not call the provider for an account with no wallets', async () => {
    let called = 0
    const { client } = await connected(undefined, {
      listWallets: async () => [],
      readPortfolio: async () => {
        called += 1
        return PORTFOLIO
      },
    })
    const result = await call(client, 'get_portfolio')
    expect(called).toBe(0)
    expect(result.isError).toBeUndefined()
    expect(result.content[0]!.text).toContain('No wallets are linked yet')
  })
})
