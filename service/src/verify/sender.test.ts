import { describe, expect, it } from 'vitest'
import { RpcReadError } from '../core/index.js'
import { httpSenderReader } from './sender.js'

/**
 * Who the chain says sent a hash, with the node answered from memory. The
 * three answers an execution report turns on: an address, "never heard of
 * it", and "could not ask".
 */
const CHAIN = 'eip155:56'
const TX = `0x${'ab'.repeat(32)}`
const FROM = '0x52908400098527886E0F7030069857D2E4169EE7'

function node(result: unknown, status = 200) {
  const asked: { method: string; params: unknown[] }[] = []
  const doFetch = (async (_url: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as { id: number; method: string; params: unknown[] }
    asked.push({ method: body.method, params: body.params })
    const answer = status === 200 ? { jsonrpc: '2.0', id: body.id, result } : { jsonrpc: '2.0', id: body.id, error: { code: -32000, message: 'down' } }
    return new Response(JSON.stringify(answer), { status, headers: { 'Content-Type': 'application/json' } })
  }) as typeof fetch
  return { doFetch, asked }
}

const transaction = {
  hash: TX,
  from: FROM,
  to: '0xd8da6bf26964af9d7eed9e03e53415d37aa96045',
  blockHash: `0x${'11'.repeat(32)}`,
  blockNumber: '0x10',
  transactionIndex: '0x0',
  nonce: '0x1',
  value: '0x0',
  gas: '0x5208',
  gasPrice: '0x3b9aca00',
  input: '0x',
  type: '0x0',
  chainId: '0x38',
  v: '0x93',
  r: `0x${'22'.repeat(32)}`,
  s: `0x${'33'.repeat(32)}`,
}

describe('reading who sent a transaction', () => {
  it('answers with the sender, lowercased, from the hash alone', async () => {
    const { doFetch, asked } = node(transaction)
    const reader = httpSenderReader({ fetch: doFetch })
    expect(await reader.sender(CHAIN, TX)).toBe(FROM.toLowerCase())
    expect(asked).toEqual([{ method: 'eth_getTransactionByHash', params: [TX] }])
  })

  it('answers null for a hash the chain has not seen', async () => {
    const { doFetch } = node(null)
    expect(await httpSenderReader({ fetch: doFetch }).sender(CHAIN, TX)).toBeNull()
  })

  /** An unreadable chain is not "not sent": the caller must be able to tell them apart. */
  it('throws, without the provider URL, when the chain cannot be read', async () => {
    const { doFetch } = node(null, 500)
    const reader = httpSenderReader({
      fetch: doFetch,
      rpcUrlTemplate: 'https://{network}.g.alchemy.com/v2/SECRET-KEY-VALUE',
      timeoutMs: 2_000,
    })
    const attempt = reader.sender(CHAIN, TX)
    await expect(attempt).rejects.toBeInstanceOf(RpcReadError)
    const message = await attempt.catch((e: Error) => e.message)
    expect(message).not.toContain('SECRET-KEY-VALUE')
    expect(message).not.toContain('alchemy.com')
  })

  it('refuses a chain it does not know rather than asking another', async () => {
    const { doFetch, asked } = node(transaction)
    await expect(httpSenderReader({ fetch: doFetch }).sender('eip155:999999', TX)).rejects.toThrow()
    expect(asked).toEqual([])
  })
})
