import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { describe, expect, it } from 'vitest'
import { PLAN_STATUSES } from '../core/index.js'
import { buildServer } from './server.js'

/**
 * The tool surface, over a real MCP client.
 *
 * In-memory transport rather than HTTP: what is being tested is what the server
 * offers and what it answers, and the Streamable HTTP layer is the SDK's code,
 * not ours. The HTTP half is covered where it is actually ours — the 401 and
 * the grant check in the OAuth tests.
 */
async function connected() {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair()
  const server = buildServer({
    userId: 'user-1',
    clientId: 'otc_test',
    scopes: ['wallets:read', 'plans:read', 'plans:write'],
  })
  const client = new Client({ name: 'test', version: '0' })
  await Promise.all([server.connect(serverSide), client.connect(clientSide)])
  return { client, server }
}

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

  it('answers with the grant it was built for, and core in the same process', async () => {
    const { client } = await connected()
    const result = await client.callTool({ name: 'whoami', arguments: {} })

    const [content] = result.content as { type: string; text: string }[]
    const body = JSON.parse(content!.text) as {
      userId: string
      clientId: string
      scopes: string[]
      planStatuses: string[]
    }

    expect(body.userId).toBe('user-1')
    expect(body.clientId).toBe('otc_test')
    expect(body.scopes).toEqual(['wallets:read', 'plans:read', 'plans:write'])
    // Read out of core rather than restated here. If these ever disagree the
    // plan format has drifted, and every review page is wrong.
    expect(body.planStatuses).toEqual([...PLAN_STATUSES])
  })

  it('marks its read-only tools as read-only, so a host can say so', async () => {
    const { client } = await connected()
    const { tools } = await client.listTools()
    const whoami = tools.find((tool) => tool.name === 'whoami')
    expect(whoami?.annotations?.readOnlyHint).toBe(true)
  })
})
