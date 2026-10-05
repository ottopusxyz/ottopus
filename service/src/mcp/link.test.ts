import { PGlite } from '@electric-sql/pglite'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { drizzle } from 'drizzle-orm/pglite'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { userIdForDid } from '../auth/session.js'
import { migrationFiles, statementsIn } from '../db/migrate.js'
import * as schema from '../db/schema.js'
import { CHALLENGE_TTL_MS, addWatchOnlyWallet, finishAgentLink, listWallets, startAgentLink } from '../wallets/index.js'
import { buildServer, type ToolDeps } from './server.js'

/**
 * Linking an agent wallet, over a real MCP client and real Postgres.
 *
 * The rest of the tool surface is tested over fakes, and this is not, on
 * purpose: what matters here is that a signature is actually verified and a
 * challenge is actually spent, and a fake would agree with whatever the tool
 * said. The keys are generated in the test and sign locally, standing in for
 * the vendor's CLI.
 */
let db: ReturnType<typeof drizzle<typeof schema>>
let pg: PGlite
let userId: string
let otherId: string
let now: Date

const SCOPES = ['wallets:read', 'wallets:write']

beforeAll(async () => {
  pg = await PGlite.create()
  await pg.exec(`create role anon; create role authenticated; create role service_role;`)
  for (const file of await migrationFiles(new URL('../../drizzle', import.meta.url).pathname)) {
    for (const stmt of await statementsIn(file)) await pg.exec(stmt)
  }
  db = drizzle(pg, { schema, casing: 'snake_case' })
  userId = await userIdForDid(db, 'did:privy:agent-owner')
  otherId = await userIdForDid(db, 'did:privy:someone-else')
}, 60_000)

beforeEach(async () => {
  await pg.exec(`delete from linked_wallets; delete from wallet_link_challenges`)
  now = new Date('2026-10-05T12:00:00.000Z')
})

/** Only what the linking tools and list_wallets read; the clock is the test's. */
const deps = (): ToolDeps =>
  ({
    listWallets: (id: string) => listWallets(db, id),
    startAgentLink: (id, input) => startAgentLink(db, id, input, now),
    finishAgentLink: (id, input) => finishAgentLink(db, id, input, now),
  }) as Partial<ToolDeps> as ToolDeps

async function connected(scopes: string[] = SCOPES, as: string = userId) {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair()
  const server = buildServer({ userId: as, clientId: 'otc_test', scopes, grantId: null }, deps())
  const client = new Client({ name: 'test', version: '0' })
  await Promise.all([server.connect(serverSide), client.connect(clientSide)])
  return client
}

type Result = {
  content: { type: string; text: string }[]
  structuredContent?: Record<string, unknown>
  isError?: boolean
}

const call = async (client: Client, name: string, args: Record<string, unknown>) =>
  (await client.callTool({ name, arguments: args })) as Result

type Wallet = ReturnType<typeof privateKeyToAccount>
const wallet = (): Wallet => privateKeyToAccount(generatePrivateKey())

async function start(client: Client, address: string) {
  const result = await call(client, 'link_agent_wallet_start', { provider: 'binance', address })
  expect(result.isError, result.content[0]!.text).toBeFalsy()
  return result.structuredContent as { challengeId: string; expiresAt: string; typedData: Record<string, unknown> }
}

/** Sign exactly what the tool handed out, the way a wallet given the JSON would. */
const sign = (signer: Wallet, typedData: Record<string, unknown>) =>
  signer.signTypedData(typedData as Parameters<Wallet['signTypedData']>[0])

describe('linking an agent wallet', () => {
  it('links the wallet whose signature answers the challenge', async () => {
    const client = await connected()
    const agent = wallet()
    const started = await call(client, 'link_agent_wallet_start', { provider: 'binance', address: agent.address })

    // The words carry the vendor's command and the data to sign.
    const words = started.content[0]!.text
    expect(words).toContain('baw sign-message preview --binanceChainId 56 --signType EIP712')
    expect(words).toContain('"primaryType":"LinkAgentWallet"')

    const challenge = started.structuredContent as { challengeId: string; expiresAt: string; typedData: any }
    expect(challenge.typedData.message).toMatchObject({
      user: userId,
      wallet: agent.address.toLowerCase(),
      provider: 'binance',
      expiresAt: new Date(now.getTime() + CHALLENGE_TTL_MS).toISOString(),
    })

    const finished = await call(client, 'link_agent_wallet_finish', {
      challengeId: challenge.challengeId,
      signature: await sign(agent, challenge.typedData),
    })
    expect(finished.isError, finished.content[0]!.text).toBeFalsy()
    expect(finished.structuredContent!.wallet).toMatchObject({
      address: agent.address.toLowerCase(),
      walletType: 'agentic',
      agentProvider: 'binance',
      watchOnly: false,
      canSign: true,
      agentExecutes: true,
      browserSigner: false,
    })

    const listed = await call(client, 'list_wallets', {})
    expect((listed.structuredContent!.wallets as unknown[]).length).toBe(1)
  })

  it('records the proof like any proved arm: what was signed, the signature, and who carried it', async () => {
    const client = await connected()
    const agent = wallet()
    const challenge = await start(client, agent.address)
    const signature = await sign(agent, challenge.typedData)
    await call(client, 'link_agent_wallet_finish', { challengeId: challenge.challengeId, signature })

    const { rows } = await pg.query<{ ownership_proof: Record<string, unknown>; proved_at: Date | null }>(
      `select ownership_proof, proved_at from linked_wallets`,
    )
    expect(rows[0]!.proved_at).not.toBeNull()
    expect(rows[0]!.ownership_proof).toMatchObject({
      via: 'agent_signed_challenge',
      challengeId: challenge.challengeId,
      signature,
      clientId: 'otc_test',
      typedData: { primaryType: 'LinkAgentWallet' },
    })
  })

  it('refuses a signature from another wallet, and leaves the challenge for the right one', async () => {
    const client = await connected()
    const agent = wallet()
    const challenge = await start(client, agent.address)

    const wrong = await call(client, 'link_agent_wallet_finish', {
      challengeId: challenge.challengeId,
      signature: await sign(wallet(), challenge.typedData),
    })
    expect(wrong.isError).toBe(true)
    expect(wrong.content[0]!.text).toMatch(/not .*sign with the wallet being linked/)
    expect(await listWallets(db, userId)).toEqual([])

    const right = await call(client, 'link_agent_wallet_finish', {
      challengeId: challenge.challengeId,
      signature: await sign(agent, challenge.typedData),
    })
    expect(right.isError).toBeFalsy()
  })

  it('refuses a signature over anything but the challenge it issued', async () => {
    const client = await connected()
    const agent = wallet()
    const challenge = await start(client, agent.address)
    const message = { ...(challenge.typedData.message as object), user: otherId }

    const result = await call(client, 'link_agent_wallet_finish', {
      challengeId: challenge.challengeId,
      signature: await sign(agent, { ...challenge.typedData, message }),
    })
    expect(result.isError).toBe(true)
    expect(await listWallets(db, userId)).toEqual([])
  })

  it('refuses an expired challenge, and says when it expired', async () => {
    const client = await connected()
    const agent = wallet()
    const challenge = await start(client, agent.address)
    const signature = await sign(agent, challenge.typedData)

    now = new Date(now.getTime() + CHALLENGE_TTL_MS)
    const result = await call(client, 'link_agent_wallet_finish', { challengeId: challenge.challengeId, signature })
    expect(result.isError).toBe(true)
    expect(result.content[0]!.text).toContain(`expired at ${challenge.expiresAt}`)
    expect(await listWallets(db, userId)).toEqual([])
  })

  it('refuses a replay, even after the wallet it linked is unlinked', async () => {
    const client = await connected()
    const agent = wallet()
    const challenge = await start(client, agent.address)
    const args = { challengeId: challenge.challengeId, signature: await sign(agent, challenge.typedData) }
    expect((await call(client, 'link_agent_wallet_finish', args)).isError).toBeFalsy()

    await pg.exec(`update linked_wallets set unlinked_at = now()`)
    const replay = await call(client, 'link_agent_wallet_finish', args)
    expect(replay.isError).toBe(true)
    expect(replay.content[0]!.text).toContain('already been used')
    expect(await listWallets(db, userId)).toEqual([])
  })

  it('does not let one account finish a challenge issued to another', async () => {
    const agent = wallet()
    const challenge = await start(await connected(), agent.address)

    const result = await call(await connected(SCOPES, otherId), 'link_agent_wallet_finish', {
      challengeId: challenge.challengeId,
      signature: await sign(agent, challenge.typedData),
    })
    expect(result.isError).toBe(true)
    expect(result.content[0]!.text).toContain('No such challenge')
    expect(await listWallets(db, otherId)).toEqual([])
  })

  it('will not re-link an address already linked as another kind, and says so', async () => {
    const client = await connected()
    const agent = wallet()
    await addWatchOnlyWallet(db, userId, { address: agent.address })

    const result = await call(client, 'link_agent_wallet_start', { provider: 'binance', address: agent.address })
    expect(result.isError).toBe(true)
    expect(result.content[0]!.text).toContain('already linked as another kind of wallet; unlink it first')
  })

  it('checks again at finish, in case the address was linked while the agent was signing', async () => {
    const client = await connected()
    const agent = wallet()
    const challenge = await start(client, agent.address)
    await addWatchOnlyWallet(db, userId, { address: agent.address })

    const args = { challengeId: challenge.challengeId, signature: await sign(agent, challenge.typedData) }
    const result = await call(client, 'link_agent_wallet_finish', args)
    expect(result.isError).toBe(true)
    expect(result.content[0]!.text).toContain('already linked as another kind of wallet')
    expect((await listWallets(db, userId)).map((arm) => arm.walletType)).toEqual(['watch_only'])

    // The refused link did not spend the challenge.
    const { rows } = await pg.query<{ consumed_at: Date | null }>(`select consumed_at from wallet_link_challenges`)
    expect(rows.map((row) => row.consumed_at)).toEqual([null])
  })

  it('gets an agent that was shown only the words through baw and back', async () => {
    const client = await connected()
    const agent = wallet()
    const started = await call(client, 'link_agent_wallet_start', { provider: 'binance', address: agent.address })
    const words = started.content[0]!.text
    const challengeId = /Challenge (\S+) for/.exec(words)![1]!

    // The preview command as a shell would take it: one single-quoted
    // argument, a whole eth_signTypedData_v4 request, typed data as a string.
    const quoted = /--message '([^']*)' --json/.exec(words)![1]!
    const request = JSON.parse(quoted) as { method: string; params: [string, string] }
    expect(request.method).toBe('eth_signTypedData_v4')
    expect(request.params[0]).toBe(agent.address.toLowerCase())
    const typedData = JSON.parse(request.params[1]) as Record<string, any>
    expect(typedData.domain).not.toHaveProperty('chainId')
    for (const step of ['wallet settings', 'execute --requestId', 'PENDING_CONFIRMATION', 'result --order-id']) {
      expect(words).toContain(step)
    }

    // What the CLI prints: the signature bare, the recovery byte beside it.
    const full = await sign(agent, typedData)
    const fromCli = { signature: full.slice(2, 130), signatureRecovery: full.endsWith('1c') ? '01' : '00' }

    // Either field alone is refused, with what is missing.
    const half = await call(client, 'link_agent_wallet_finish', { challengeId, signature: fromCli.signature })
    expect(half.isError).toBe(true)
    expect(half.content[0]!.text).toContain('signatureRecovery')

    const finished = await call(client, 'link_agent_wallet_finish', {
      challengeId,
      signature: `0x${fromCli.signature}${fromCli.signatureRecovery}`,
    })
    expect(finished.isError, finished.content[0]!.text).toBeFalsy()
    expect((await listWallets(db, userId)).map((arm) => arm.address)).toEqual([agent.address.toLowerCase()])
  })

  it('links once when two finishes race on one challenge', async () => {
    const client = await connected()
    const agent = wallet()
    const challenge = await start(client, agent.address)
    const args = { challengeId: challenge.challengeId, signature: await sign(agent, challenge.typedData) }

    const results = await Promise.all([
      call(client, 'link_agent_wallet_finish', args),
      call(client, 'link_agent_wallet_finish', args),
    ])
    expect(results.filter((result) => !result.isError)).toHaveLength(1)
    expect(await listWallets(db, userId)).toHaveLength(1)
  })

  it('refuses a provider it has no profile for', async () => {
    const result = await call(await connected(), 'link_agent_wallet_start', {
      provider: 'constructor',
      address: wallet().address,
    })
    expect(result.isError).toBe(true)
    expect(result.content[0]!.text).toContain('not an agent wallet provider')
  })

  it('refuses both tools without wallets:write, naming the scope', async () => {
    const client = await connected(['wallets:read', 'plans:read', 'plans:write'])
    const agent = wallet()

    const started = await call(client, 'link_agent_wallet_start', { provider: 'binance', address: agent.address })
    expect(started.isError).toBe(true)
    expect(started.content[0]!.text).toContain('wallets:write')
    expect(started.content[0]!.text).toContain('never granted by default')

    // A challenge from a grant that has the scope is no use to one that lacks it.
    const challenge = await start(await connected(), agent.address)
    const finished = await call(client, 'link_agent_wallet_finish', {
      challengeId: challenge.challengeId,
      signature: await sign(agent, challenge.typedData),
    })
    expect(finished.isError).toBe(true)
    expect(finished.content[0]!.text).toContain('wallets:write')
    expect(await listWallets(db, userId)).toEqual([])
  })
})
