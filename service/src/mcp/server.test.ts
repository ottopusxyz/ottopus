import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { describe, expect, it } from 'vitest'
import { encodeFunctionData } from 'viem'
import type { Portfolio } from '../connectors/portfolio/index.js'
import type { CreatePlanInput, PlanRecord } from '../plans/index.js'
import { PlanError } from '../plans/index.js'
import { planFor } from '../plans/fixtures.js'
import { KNOWN_ABI, type Lookups } from '../verify/index.js'
import type { SimulationRun, Simulator } from '../connectors/simulation/index.js'
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
  byType: { wallet: 2000, deposit: 0, loan: 0, locked: 0, staked: 0, reward: 0, investment: 0 },
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
      value: 2000,
      price: 1589.7,
      change1d: 12.4,
      share: 1,
      holdings: [{ walletId: 'w1', amount: '1258100000000000000', value: 2000 }],
    },
  ],
  unpriced: 0,
  protocols: [],
}

/** A real uuid: the plan schema insists, and so does the database. */
const USER_ID = '0191a2b3-c4d5-4e6f-8a9b-0c1d2e3f4a5b'
const USDC = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913'
const BASE = 'eip155:8453'

/** The decoder's reads, answered from memory: USDC is a verified contract, everything else a wallet. */
const lookups: Lookups = {
  async getCode(_chain, address) {
    return address.toLowerCase() === USDC ? '0x6080' : '0x'
  },
  async sourcify(_chain, address) {
    return address.toLowerCase() === USDC ? { abi: KNOWN_ABI, name: 'FiatTokenV2_2', match: 'exact_match' } : null
  },
  async fourByte() {
    return []
  },
  async resolveName(name) {
    return name === 'koshik.eth' ? '0x67d29520c6f9579fe4b32dcba346620846ef98d2' : null
  },
}

/** A store in memory: keeps what createPlan was handed, hands back a record. */
function planSink() {
  const created: CreatePlanInput[] = []
  return {
    created,
    createPlan: async (input: CreatePlanInput): Promise<PlanRecord> => {
      created.push(input)
      return { plan: input.plan, walletId: input.walletId ?? null, grantId: input.grantId ?? null, createdAt: 'now', statusAt: 'now', statusDetail: null }
    },
  }
}

const deps = (over: Partial<ToolDeps> = {}): ToolDeps => ({
  findUser: async (id) => ({ id, privyDid: 'did:privy:1', email: 'koshik@example.com', name: 'Koshik Raj' }),
  findAgent: async () => ({ clientName: 'Claude' }),
  listWallets: async () => WALLETS,
  readPortfolio: async () => PORTFOLIO,
  lookups,
  simulator: null,
  createPlan: planSink().createPlan,
  issueReviewLink: async (planId, version) => ({
    token: 'tok',
    url: `https://ottopus.test/review/tok-${planId.slice(0, 4)}-v${version}`,
    expiresAt: '2026-09-09T10:15:00Z',
  }),
  findPlan: async () => null,
  transition: async (input) => input.to,
  ...over,
})

async function connected(
  scopes = ['wallets:read', 'plans:read', 'plans:write'],
  over: Partial<ToolDeps> = {},
  ctx: { grantId?: string | null } = {},
) {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair()
  const server = buildServer(
    { userId: USER_ID, clientId: 'otc_test', scopes, grantId: ctx.grantId ?? null },
    deps(over),
  )
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

  it('offers four read tools and two that write, and says which is which', async () => {
    const { client } = await connected()
    const { tools } = await client.listTools()
    expect(tools.map((tool) => tool.name).sort()).toEqual([
      'cancel_plan',
      'get_plan',
      'get_portfolio',
      'list_wallets',
      'prepare_transfer',
      'whoami',
    ])
    for (const tool of tools) {
      const readOnly = !['prepare_transfer', 'cancel_plan'].includes(tool.name)
      expect(tool.annotations?.readOnlyHint, `${tool.name} read-only=${readOnly}`).toBe(readOnly)
      expect(tool.annotations?.destructiveHint ?? false, `${tool.name} is never destructive`).toBe(false)
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
    expect(result.content[0]!.text).not.toContain(USER_ID)
    expect(result.content[0]!.text).not.toContain('otc_test')
    expect(result.structuredContent).toMatchObject({
      user: { id: USER_ID, name: 'Koshik Raj', email: 'koshik@example.com' },
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
    expect(words).toContain('- 1.2581 ETH on Ethereum in Main — $2,000.00')
    expect(result.structuredContent).toMatchObject({
      total: 2000,
      omitted: 0,
      assets: [{ symbol: 'ETH', wallets: [{ id: 'w1', name: 'Main', amount: '1.2581' }] }],
    })
  })

  it('reads only the wallet asked for, and never another account’s id', async () => {
    const seen: string[][] = []
    const { client } = await connected(undefined, {
      readPortfolio: async (arms) => {
        seen.push(arms.map((arm) => arm.walletId))
        return PORTFOLIO
      },
    })
    await call(client, 'get_portfolio', { walletId: 'w2' })
    expect(seen).toEqual([['w2']])

    const stranger = await call(client, 'get_portfolio', { walletId: 'w-someone-else' })
    expect(stranger.isError).toBe(true)
    expect(stranger.content[0]!.text).toContain('No linked wallet has the id')
    // The provider was not asked: an unknown id is an answer, not a read.
    expect(seen).toHaveLength(1)
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

describe('prepare_transfer', () => {
  /** Balances on Base: Main holds USDC and ETH; the watch-only wallet holds USDC too. */
  const baseHoldings: Portfolio = {
    ...PORTFOLIO,
    chains: [{ chainId: BASE, name: 'Base', value: 2000, share: 1 }],
    assets: [
      {
        assetId: `${BASE}/erc20:${USDC}`,
        chainId: BASE,
        asset: { symbol: 'USDC', name: 'USD Coin', decimals: 6, iconUrl: null, verified: true },
        amount: '1500000000',
        value: 1500,
        price: 1,
        change1d: 0,
        share: 0.75,
        holdings: [
          { walletId: 'w1', amount: '1000000000', value: 1000 },
          { walletId: 'w2', amount: '500000000', value: 500 },
        ],
      },
      {
        assetId: `${BASE}/slip44:60`,
        chainId: BASE,
        asset: { symbol: 'ETH', name: 'Ether', decimals: 18, iconUrl: null, verified: true },
        amount: '300000000000000000',
        value: 500,
        price: 1666,
        change1d: 0,
        share: 0.25,
        holdings: [{ walletId: 'w1', amount: '300000000000000000', value: 500 }],
      },
    ],
  }
  const RECIPIENT = `${BASE}:0x1111111111111111111111111111111111111111`
  const send = (client: Client, args: Record<string, unknown>) =>
    client.callTool({
      name: 'prepare_transfer',
      arguments: { asset: `${BASE}/erc20:${USDC}`, amount: '500000000', to: RECIPIENT, ...args },
    })

  it('builds a USDC transfer from the recommended wallet and returns a link, never the calls', async () => {
    const sink = planSink()
    const { client } = await connected(undefined, { readPortfolio: async () => baseHoldings, createPlan: sink.createPlan }, {
      grantId: 'grant-1',
    })
    const res = (await send(client, {})) as { content: { text: string }[]; structuredContent: Record<string, unknown>; isError?: boolean }

    expect(res.isError).toBeFalsy()
    expect(res.content[0]!.text).toMatch(/^Plan ready: Send 500 USDC to 0x1111…1111 from Main on Base\./)
    expect(res.content[0]!.text).toMatch(/Recommended Main \(…6045\) because it holds 1,000 USDC on Base/)
    expect(res.content[0]!.text).toMatch(/Review and sign: https:\/\/ottopus\.test\/review\//)
    expect(res.structuredContent).toMatchObject({
      status: 'awaiting_review',
      summary: 'Send 500 USDC to 0x1111…1111 from Main on Base',
      recommendedAccount: 'Main (0xd8da…6045)',
      warnings: [],
    })
    expect(JSON.stringify(res)).not.toContain('"calls"')
    expect(JSON.stringify(res)).not.toContain('0xa9059cbb')

    expect(sink.created).toHaveLength(1)
    const { plan, walletId, grantId } = sink.created[0]!
    expect(walletId).toBe('w1')
    expect(grantId).toBe('grant-1')
    expect(plan.status).toBe('awaiting_review')
    expect(plan.planHash).toMatch(/^[0-9a-f]{64}$/)
    expect(plan.outcome.type === 'calls' && plan.outcome.calls).toEqual([
      {
        to: `${BASE}:${USDC}`,
        value: '0',
        data: encodeFunctionData({ abi: KNOWN_ABI, functionName: 'transfer', args: ['0x1111111111111111111111111111111111111111', 500_000_000n] }).toLowerCase(),
        chainId: BASE,
      },
    ])
    expect(plan.decodedActions[0]).toMatchObject({ function: 'transfer(address,uint256)', verified: true, source: 'abi' })
    expect(plan.humanPlan.assets).toEqual([{ id: `${BASE}/erc20:${USDC}`, symbol: 'USDC', decimals: 6 }])
    expect(plan.resolution.candidatesConsidered.map((c) => c.reason)).toEqual(['is watch-only and cannot sign'])
  })

  it('builds a native transfer as value with no calldata', async () => {
    const sink = planSink()
    const { client } = await connected(undefined, { readPortfolio: async () => baseHoldings, createPlan: sink.createPlan })
    const res = (await send(client, { asset: `${BASE}/slip44:60`, amount: '100000000000000000' })) as { isError?: boolean; content: { text: string }[] }
    expect(res.isError).toBeFalsy()
    expect(res.content[0]!.text).toMatch(/Send 0\.1 ETH to 0x1111…1111 from Main on Base/)
    const plan = sink.created[0]!.plan
    expect(plan.outcome.type === 'calls' && plan.outcome.calls[0]).toEqual({ to: RECIPIENT, value: '100000000000000000', data: '0x', chainId: BASE })
  })

  it('honours a chosen wallet', async () => {
    const sink = planSink()
    const { client } = await connected(undefined, { readPortfolio: async () => baseHoldings, createPlan: sink.createPlan })
    const res = (await send(client, { fromAccount: `${BASE}:${WALLETS[0]!.address}` })) as { content: { text: string }[] }
    expect(res.content[0]!.text).toMatch(/You chose Main \(…6045\)/)
    expect(sink.created[0]!.walletId).toBe('w1')
  })

  it('refuses when no wallet can, names why, and creates no plan', async () => {
    const sink = planSink()
    const { client } = await connected(undefined, { readPortfolio: async () => baseHoldings, createPlan: sink.createPlan })
    const res = (await send(client, { amount: '5000000000' })) as { isError?: boolean; content: { text: string }[] }
    expect(res.isError).toBe(true)
    expect(res.content[0]!.text).toMatch(/No linked wallet can make this transfer/)
    expect(res.content[0]!.text).toMatch(/Main \(…6045\) holds only 1,000 USDC on Base, short of 5,000 USDC/)
    expect(res.content[0]!.text).toMatch(/watch-only/)
    expect(sink.created).toHaveLength(0)
  })

  it('refuses a chosen wallet that cannot, with the reason', async () => {
    const sink = planSink()
    const { client } = await connected(undefined, { readPortfolio: async () => baseHoldings, createPlan: sink.createPlan })
    const res = (await send(client, { fromAccount: `${BASE}:${WALLETS[1]!.address}` })) as { isError?: boolean; content: { text: string }[] }
    expect(res.isError).toBe(true)
    expect(res.content[0]!.text).toMatch(/is watch-only and cannot sign/)
    expect(sink.created).toHaveLength(0)
  })

  /**
   * Verify refusing what the tool itself built. Forced by telling the decoder
   * the token has no code: the plan is stored as blocked with the reason, the
   * agent gets the reason, and no link is minted.
   */
  it('stores a blocked plan with its reasons and mints no link', async () => {
    const sink = planSink()
    let linked = 0
    const { client } = await connected(undefined, {
      readPortfolio: async () => baseHoldings,
      createPlan: sink.createPlan,
      lookups: { ...lookups, getCode: async () => '0x' },
      issueReviewLink: async () => {
        linked += 1
        return { token: 't', url: 'u', expiresAt: 'e' }
      },
    })
    const res = (await send(client, {})) as { isError?: boolean; content: { text: string }[]; structuredContent: Record<string, unknown> }
    expect(res.isError).toBe(true)
    expect(res.content[0]!.text).toMatch(/Ottopus refused to build "Send 500 USDC/)
    expect(res.content[0]!.text).toMatch(/has no code on Base/)
    expect(res.structuredContent).toMatchObject({ status: 'blocked' })
    expect(linked).toBe(0)
    const plan = sink.created[0]!.plan
    expect(plan.status).toBe('blocked')
    expect(plan.humanPlan.warnings[0]).toMatchObject({ severity: 'block', code: 'verify_failed' })
  })

  it('resolves an ENS recipient, keeps the name on the intent, and shows both', async () => {
    const sink = planSink()
    const { client } = await connected(undefined, { readPortfolio: async () => baseHoldings, createPlan: sink.createPlan })
    const res = (await send(client, { to: 'Koshik.eth' })) as { isError?: boolean; content: { text: string }[] }
    expect(res.isError).toBeFalsy()
    expect(res.content[0]!.text).toMatch(/Send 500 USDC to koshik\.eth \(0x67d2…98d2\) from Main on Base/)
    const plan = sink.created[0]!.plan
    expect(plan.intent.kind === 'transfer' && plan.intent.to).toBe(`${BASE}:0x67d29520c6f9579fe4b32dcba346620846ef98d2`)
    expect(plan.intent.kind === 'transfer' && plan.intent.toName).toBe('koshik.eth')
    // The call goes to the resolved address, on the asset's chain.
    expect(plan.outcome.type === 'calls' && plan.outcome.calls[0]!.data).toContain('67d29520c6f9579fe4b32dcba346620846ef98d2')
  })

  it('accepts a bare address and places it on the asset’s chain', async () => {
    const sink = planSink()
    const { client } = await connected(undefined, { readPortfolio: async () => baseHoldings, createPlan: sink.createPlan })
    const res = (await send(client, { to: '0x1111111111111111111111111111111111111111' })) as { isError?: boolean }
    expect(res.isError).toBeFalsy()
    expect(sink.created[0]!.plan.intent.kind === 'transfer' && sink.created[0]!.plan.intent.to).toBe(RECIPIENT)
  })

  it('refuses a name that does not resolve, and never guesses', async () => {
    const sink = planSink()
    const { client } = await connected(undefined, { readPortfolio: async () => baseHoldings, createPlan: sink.createPlan })
    const res = (await send(client, { to: 'nobody-here.eth' })) as { isError?: boolean; content: { text: string }[] }
    expect(res.isError).toBe(true)
    expect(res.content[0]!.text).toMatch(/nobody-here\.eth does not resolve to an address on ENS/)
    expect(sink.created).toHaveLength(0)
  })

  it('tells the agent where asset ids come from when it hands over a symbol', async () => {
    const sink = planSink()
    const { client } = await connected(undefined, { createPlan: sink.createPlan })
    const res = (await send(client, { asset: 'USDC' })) as { isError?: boolean; content: { text: string }[] }
    expect(res.isError).toBe(true)
    expect(res.content[0]!.text).toMatch(/get_portfolio lists each holding's assetId/)
  })

  it('keeps the note on the intent, where the hash covers it', async () => {
    const sink = planSink()
    const { client } = await connected(undefined, { readPortfolio: async () => baseHoldings, createPlan: sink.createPlan })
    await send(client, { note: '  invoice 42 ' })
    const plan = sink.created[0]!.plan
    expect(plan.intent.note).toBe('invoice 42')
    expect(plan.humanPlan.steps).toContain('Note from the request: invoice 42')
  })

  it('refuses a chain whose currency it cannot name, in a sentence, before reading anything', async () => {
    const sink = planSink()
    let read = 0
    const { client } = await connected(undefined, {
      readPortfolio: async () => {
        read += 1
        return baseHoldings
      },
      createPlan: sink.createPlan,
    })
    // Cronos: viem knows it, the coin-type table does not, and it does not spend ETH.
    const res = (await send(client, {
      asset: 'eip155:25/erc20:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
      to: 'eip155:25:0x1111111111111111111111111111111111111111',
    })) as { isError?: boolean; content: { text: string }[] }
    expect(res.isError).toBe(true)
    expect(res.content[0]!.text).toMatch(/Cronos Mainnet \(eip155:25\) is not supported for transfers yet/)
    expect(read).toBe(0)
    expect(sink.created).toHaveLength(0)
  })

  it('rejects an intent it cannot parse before touching anything', async () => {
    const sink = planSink()
    const { client } = await connected(undefined, { createPlan: sink.createPlan })
    const res = (await send(client, { to: 'eip155:1:0x1111111111111111111111111111111111111111' })) as { isError?: boolean; content: { text: string }[] }
    expect(res.isError).toBe(true)
    expect(res.content[0]!.text).toMatch(/not a transfer Ottopus can build/)
    expect(sink.created).toHaveLength(0)
  })

  it('refuses without plans:write, and says what to change', async () => {
    const { client } = await connected(['wallets:read'])
    const res = (await send(client, {})) as { isError?: boolean; content: { text: string }[] }
    expect(res.isError).toBe(true)
    expect(res.content[0]!.text).toMatch(/plans:write/)
  })

  it('says plainly when there is no balance provider to choose a wallet with', async () => {
    const { client } = await connected(undefined, { readPortfolio: null })
    const res = (await send(client, {})) as { isError?: boolean; content: { text: string }[] }
    expect(res.isError).toBe(true)
    expect(res.content[0]!.text).toMatch(/balances are not available/)
  })
})

/**
 * A plan on record, as the store would hand it back. The grant is the knob:
 * it decides whether the agent asking may know the plan exists.
 */
function onRecord(over: Partial<PlanRecord> & { status?: PlanRecord['plan']['status'] } = {}): PlanRecord {
  const { status, ...rest } = over
  return {
    plan: planFor(USER_ID, status ? { status } : {}),
    walletId: 'w1',
    grantId: 'grant-1',
    createdAt: '2026-09-09T10:00:00Z',
    statusAt: '2026-09-09T10:01:00Z',
    statusDetail: null,
    ...rest,
  }
}

const TX = '0x' + 'ab'.repeat(32)

describe('get_plan', () => {
  it('reports status and outcome for a plan this grant made, and never the calls', async () => {
    const record = onRecord()
    const { client } = await connected(undefined, { findPlan: async () => record }, { grantId: 'grant-1' })
    const result = await call(client, 'get_plan', { planId: record.plan.id })
    const words = result.content[0]!.text

    expect(result.isError).toBeUndefined()
    expect(words).toContain('Send 1000 wei to vitalik.eth.')
    expect(words).toContain('Status: awaiting_review. Waiting for the person to open the review link')
    expect(words).toContain('only funded account')
    expect(result.structuredContent).toMatchObject({
      planId: record.plan.id,
      version: 1,
      status: 'awaiting_review',
      chain: { id: 'eip155:8453', name: 'Base' },
      txHash: null,
      explorerUrl: null,
    })
    // The whole answer, searched for anything a wallet could execute.
    const everything = JSON.stringify(result)
    for (const secret of ['calls', 'decodedActions', 'evidence', 'planHash', '"data"', 'value']) {
      expect(everything, `${secret} must stay on the review page`).not.toContain(secret)
    }
  })

  it('is not found for another grant, nor for a plan built on the web', async () => {
    for (const grantId of ['grant-2', null]) {
      const record = onRecord({ grantId })
      const { client } = await connected(undefined, { findPlan: async () => record }, { grantId: 'grant-1' })
      const result = await call(client, 'get_plan', { planId: record.plan.id })
      expect(result.isError, `grant ${grantId}`).toBe(true)
      expect(result.content[0]!.text).toContain('only see plans this connection built')
      expect(result.structuredContent).toBeUndefined()
    }
  })

  it('carries the transaction hash once submitted, and the outcome in words once confirmed', async () => {
    const submitted = onRecord({ status: 'submitted', statusDetail: { txHash: TX } })
    let { client } = await connected(undefined, { findPlan: async () => submitted }, { grantId: 'grant-1' })
    let result = await call(client, 'get_plan', { planId: submitted.plan.id })
    expect(result.content[0]!.text).toContain(`Signed and sent to Base; waiting for the chain to confirm it. Transaction ${TX}.`)
    expect(result.structuredContent).toMatchObject({ status: 'submitted', txHash: TX, explorerUrl: `https://basescan.org/tx/${TX}` })

    const confirmed = onRecord({ status: 'confirmed', statusDetail: { txHash: TX } })
    ;({ client } = await connected(undefined, { findPlan: async () => confirmed }, { grantId: 'grant-1' }))
    result = await call(client, 'get_plan', { planId: confirmed.plan.id })
    expect(result.content[0]!.text).toContain('Confirmed on Base: Send 1000 wei to vitalik.eth went through.')
    expect(result.content[0]!.text).toContain(`Explorer: https://basescan.org/tx/${TX}`)

    const failed = onRecord({ status: 'failed', statusDetail: { txHash: TX, reason: 'reverted' } })
    ;({ client } = await connected(undefined, { findPlan: async () => failed }, { grantId: 'grant-1' }))
    result = await call(client, 'get_plan', { planId: failed.plan.id })
    expect(result.content[0]!.text).toContain('The transaction failed on Base (reverted). The transfer did not happen')
  })

  it('refuses a malformed id without asking the store', async () => {
    let asked = 0
    const { client } = await connected(undefined, {
      findPlan: async () => {
        asked += 1
        return onRecord()
      },
    }, { grantId: 'grant-1' })
    const result = await call(client, 'get_plan', { planId: 'not-a-uuid' })
    expect(result.isError).toBe(true)
    expect(asked).toBe(0)
  })

  it('refuses without plans:read', async () => {
    const { client } = await connected(['wallets:read', 'plans:write'], { findPlan: async () => onRecord() }, { grantId: 'grant-1' })
    const result = await call(client, 'get_plan', { planId: onRecord().plan.id })
    expect(result.isError).toBe(true)
    expect(result.content[0]!.text).toContain('plans:read')
  })
})

describe('cancel_plan', () => {
  it('cancels an unsigned plan through the store, as this user', async () => {
    const record = onRecord()
    const moves: unknown[] = []
    const { client } = await connected(undefined, {
      findPlan: async () => record,
      transition: async (input) => {
        moves.push(input)
        return input.to
      },
    }, { grantId: 'grant-1' })
    const result = await call(client, 'cancel_plan', { planId: record.plan.id })

    expect(result.isError).toBeUndefined()
    expect(moves).toEqual([{ userId: USER_ID, planId: record.plan.id, version: 1, to: 'cancelled' }])
    expect(result.content[0]!.text).toContain('Cancelled: Send 1000 wei to vitalik.eth. Nothing was sent')
    expect(result.structuredContent).toMatchObject({ planId: record.plan.id, status: 'cancelled', cancelled: true })
    expect(JSON.stringify(result)).not.toContain('calls')
  })

  it('is refused after submission, and says so rather than failing silently', async () => {
    const record = onRecord({ status: 'submitted', statusDetail: { txHash: TX } })
    const { client } = await connected(undefined, {
      findPlan: async () => record,
      transition: async () => {
        throw new PlanError('illegal_transition', 'submitted -> cancelled is not allowed')
      },
    }, { grantId: 'grant-1' })
    const result = await call(client, 'cancel_plan', { planId: record.plan.id })

    expect(result.isError).toBe(true)
    expect(result.content[0]!.text).toContain('Too late to cancel: Send 1000 wei to vitalik.eth was already signed and sent to Base.')
    expect(result.content[0]!.text).toContain(`Transaction ${TX}`)
    expect(result.structuredContent).toMatchObject({ status: 'submitted', cancelled: false, txHash: TX })
  })

  it('says there is nothing to cancel once a plan has ended', async () => {
    const record = onRecord({ status: 'cancelled' })
    const { client } = await connected(undefined, {
      findPlan: async () => record,
      transition: async () => {
        throw new PlanError('illegal_transition', 'cancelled -> cancelled is not allowed')
      },
    }, { grantId: 'grant-1' })
    const result = await call(client, 'cancel_plan', { planId: record.plan.id })
    expect(result.isError).toBe(true)
    expect(result.content[0]!.text).toContain('Nothing to cancel: Send 1000 wei to vitalik.eth is already cancelled.')
  })

  it('cannot cancel another grant’s plan, and never reaches the store trying', async () => {
    let moved = 0
    const { client } = await connected(undefined, {
      findPlan: async () => onRecord({ grantId: 'grant-2' }),
      transition: async (input) => {
        moved += 1
        return input.to
      },
    }, { grantId: 'grant-1' })
    const result = await call(client, 'cancel_plan', { planId: onRecord().plan.id })
    expect(result.isError).toBe(true)
    expect(result.content[0]!.text).toContain('only see plans this connection built')
    expect(moved).toBe(0)
  })

  it('refuses without plans:write', async () => {
    const { client } = await connected(['wallets:read', 'plans:read'], { findPlan: async () => onRecord() }, { grantId: 'grant-1' })
    const result = await call(client, 'cancel_plan', { planId: onRecord().plan.id })
    expect(result.isError).toBe(true)
    expect(result.content[0]!.text).toContain('plans:write')
  })
})

/**
 * A simulator whose answer the test dictates, so the pipeline can be checked
 * on what a simulation does to a plan rather than on what a chain says today.
 */
function stubSimulator(over: Partial<SimulationRun> = {}): Simulator {
  return {
    name: 'stub',
    serves: () => true,
    async simulate(request) {
      return {
        provider: 'stub',
        chainId: request.chainId,
        blockNumber: '51119499',
        success: true,
        gasUsed: '44831',
        assetChanges: [
          {
            assetId: `${BASE}/erc20:${USDC}`,
            symbol: 'USDC',
            decimals: 6,
            diff: '-500000000',
            pre: '1000000000',
            post: '500000000',
          },
        ],
        tracedAssets: true,
        ranAt: '2026-09-10T12:00:00.000Z',
        raw: { baseFeePerGas: '1000000000' },
        ...over,
      }
    },
  }
}

describe('prepare_transfer with a simulation', () => {
  const holdings: Portfolio = {
    ...PORTFOLIO,
    chains: [{ chainId: BASE, name: 'Base', value: 2000, share: 1 }],
    assets: [
      {
        assetId: `${BASE}/erc20:${USDC}`,
        chainId: BASE,
        asset: { symbol: 'USDC', name: 'USD Coin', decimals: 6, iconUrl: null, verified: true },
        amount: '1000000000',
        value: 1000,
        price: 1,
        change1d: 0,
        share: 0.7,
        holdings: [{ walletId: 'w1', amount: '1000000000', value: 1000 }],
      },
      {
        assetId: `${BASE}/slip44:60`,
        chainId: BASE,
        asset: { symbol: 'ETH', name: 'Ether', decimals: 18, iconUrl: null, verified: true },
        amount: '300000000000000000',
        value: 500,
        price: 4000,
        change1d: 0,
        share: 0.3,
        holdings: [{ walletId: 'w1', amount: '300000000000000000', value: 500 }],
      },
    ],
  }
  const send = (client: Client) =>
    client.callTool({
      name: 'prepare_transfer',
      arguments: {
        asset: `${BASE}/erc20:${USDC}`,
        amount: '500000000',
        to: `${BASE}:0x1111111111111111111111111111111111111111`,
      },
    })

  it('attaches the run as evidence and prices the fee into the plan', async () => {
    const sink = planSink()
    const logged: { planId: string; simulation: { provider: string } }[] = []
    const { client } = await connected(undefined, {
      readPortfolio: async () => holdings,
      simulator: stubSimulator(),
      createPlan: sink.createPlan,
      recordSimulation: async (input) => {
        logged.push(input as never)
      },
    }, { grantId: 'grant-1' })

    const res = (await send(client)) as { isError?: boolean; content: { text: string }[] }
    expect(res.isError).toBeFalsy()

    const plan = sink.created[0]!.plan
    expect(plan.status).toBe('awaiting_review')
    expect(plan.simulation).toMatchObject({ provider: 'stub', success: true, gasUsed: '44831', blockNumber: '51119499' })
    // 44831 gas at 1 gwei is 0.0000448 ETH; at $4,000 that is 18 cents, and
    // the fee is part of the human plan, so the hash covers it.
    expect(plan.simulation?.gasUsd).toBe('0.17')
    expect(plan.humanPlan.feesUsd).toBe('0.17')
    expect(logged).toHaveLength(1)
    expect(logged[0]).toMatchObject({ planId: plan.id, simulation: { provider: 'stub' } })
    // Evidence stays evidence: nothing an agent could execute comes back.
    expect(JSON.stringify(res)).not.toContain('assetChanges')
  })

  it('blocks the plan when the simulation says the call reverts, and says why', async () => {
    const sink = planSink()
    const { client } = await connected(undefined, {
      readPortfolio: async () => holdings,
      simulator: stubSimulator({
        success: false,
        assetChanges: [],
        revertReason: 'ERC20: transfer amount exceeds balance',
        failedCall: 1,
      }),
      createPlan: sink.createPlan,
    }, { grantId: 'grant-1' })

    const res = (await send(client)) as { isError?: boolean; content: { text: string }[]; structuredContent?: Record<string, unknown> }
    expect(res.isError).toBe(true)
    expect(res.content[0]!.text).toContain('the simulation failed on call 1: ERC20: transfer amount exceeds balance')
    expect(sink.created[0]!.plan.status).toBe('blocked')
    // A blocked plan never gets a link.
    expect(JSON.stringify(res)).not.toContain('review/')
  })

  it('blocks a plan whose simulation shows a second asset leaving', async () => {
    const sink = planSink()
    const { client } = await connected(undefined, {
      readPortfolio: async () => holdings,
      simulator: stubSimulator({
        assetChanges: [
          { assetId: `${BASE}/erc20:${USDC}`, symbol: 'USDC', decimals: 6, diff: '-500000000', pre: '1000000000', post: '500000000' },
          { assetId: `${BASE}/slip44:60`, symbol: 'ETH', decimals: 18, diff: '-90000000000000000', pre: '300000000000000000', post: '210000000000000000' },
        ],
      }),
      createPlan: sink.createPlan,
    }, { grantId: 'grant-1' })

    const res = (await send(client)) as { isError?: boolean; content: { text: string }[] }
    expect(res.isError).toBe(true)
    expect(res.content[0]!.text).toContain('the simulation shows ETH leaving the wallet as well')
    expect(sink.created[0]!.plan.status).toBe('blocked')
  })

  /** No simulator, or one that cannot answer, must not read as a problem. */
  it('still builds a reviewable plan when no simulator serves the chain', async () => {
    const sink = planSink()
    const { client } = await connected(undefined, {
      readPortfolio: async () => holdings,
      simulator: { name: 'stub', serves: () => false, simulate: async () => { throw new Error('never asked') } },
      createPlan: sink.createPlan,
    }, { grantId: 'grant-1' })

    const res = (await send(client)) as { isError?: boolean }
    expect(res.isError).toBeFalsy()
    expect(sink.created[0]!.plan.simulation).toBeNull()
    expect(sink.created[0]!.plan.humanPlan.feesUsd).toBe('unknown')
  })

  it('treats a simulator that throws as no evidence rather than a refusal', async () => {
    const sink = planSink()
    const { client } = await connected(undefined, {
      readPortfolio: async () => holdings,
      simulator: {
        name: 'stub',
        serves: () => true,
        simulate: async () => {
          throw new Error('the provider is down')
        },
      },
      createPlan: sink.createPlan,
    }, { grantId: 'grant-1' })

    const res = (await send(client)) as { isError?: boolean }
    expect(res.isError).toBeFalsy()
    expect(sink.created[0]!.plan.status).toBe('awaiting_review')
    expect(sink.created[0]!.plan.simulation).toBeNull()
  })
})
