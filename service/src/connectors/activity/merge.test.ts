import { describe, expect, it } from 'vitest'
import type { ArmRef } from '../portfolio/aggregate.js'
import { PortfolioError, type AccountRef } from '../portfolio/types.js'
import { decodeCursor, encodeCursor, readActivity, type ActivityRow } from './merge.js'
import type { Activity, ActivityConnector, ActivityQuery } from './types.js'

const ARM_A: ArmRef = { walletId: 'a', namespace: 'eip155', address: '0xa' }
const ARM_B: ArmRef = { walletId: 'b', namespace: 'eip155', address: '0xb' }

/** A transaction at a given second, on Base, with nothing in it. */
function tx(id: string, minedAt: string, overrides: Partial<Activity> = {}): Activity {
  return {
    id,
    hash: `0x${id}`,
    chainId: 'eip155:8453',
    minedAt,
    block: 1,
    status: 'confirmed',
    kind: 'send',
    from: '0xa',
    to: '0xb',
    fee: null,
    transfers: [],
    approvals: [],
    app: null,
    ...overrides,
  }
}

/**
 * A provider over in-memory streams that honours the bound the way Zerion
 * does: everything mined at or before `before`, newest first, `size` at a time.
 */
function connector(streams: Record<string, Activity[]>, failing: string[] = []): ActivityConnector {
  return {
    provider: 'fake',
    chainName: (chainId) => (chainId === 'eip155:8453' ? 'Base' : null),
    async transactionsFor(account: AccountRef, query: ActivityQuery) {
      if (failing.includes(account.address)) throw new PortfolioError('rate_limited', 'nope')
      const all = [...(streams[account.address] ?? [])]
        .filter((item) => !query.chainId || item.chainId === query.chainId)
        .filter((item) => !query.kinds || query.kinds.includes(item.kind))
        .filter((item) => !query.before || Date.parse(item.minedAt) <= Date.parse(query.before))
        .sort((x, y) => Date.parse(y.minedAt) - Date.parse(x.minedAt))
      return { items: all.slice(0, query.size), more: all.length > query.size }
    },
  }
}

const at = (n: number) => new Date(Date.UTC(2026, 8, 11, 12, 0, n)).toISOString().replace('.000Z', 'Z')

/** Every page until the cursor runs out, as a list of pages. */
async function drain(c: ActivityConnector, arms: ArmRef[], size: number, query: { chainId?: string } = {}) {
  const pages: ActivityRow[][] = []
  let cursor: string | null = null
  for (let i = 0; i < 20; i++) {
    const feed = await readActivity(c, arms, { size, cursor, ...query })
    pages.push(feed.items)
    cursor = feed.cursor
    if (!cursor) break
  }
  return pages
}

describe('merging arms', () => {
  it('interleaves two arms newest first', async () => {
    const c = connector({
      '0xa': [tx('a1', at(50)), tx('a2', at(30))],
      '0xb': [tx('b1', at(40)), tx('b2', at(20))],
    })
    const feed = await readActivity(c, [ARM_A, ARM_B], { size: 10 })
    expect(feed.items.map((i) => `${i.walletId}:${i.id}`)).toEqual(['a:a1', 'b:b1', 'a:a2', 'b:b2'])
    expect(feed.cursor).toBeNull()
    expect(feed.chains).toEqual([{ chainId: 'eip155:8453', name: 'Base', iconUrl: null }])
  })

  it('pages the merge without skipping or repeating a row', async () => {
    // A is busy and recent; B is sparse and old. Page 1 of each is not enough
    // to know where B's rows go, which is what the watermark is for.
    const a = Array.from({ length: 9 }, (_, i) => tx(`a${i}`, at(59 - i)))
    const b = [tx('b0', at(55)), tx('b1', at(45)), tx('b2', at(5))]
    const c = connector({ '0xa': a, '0xb': b })

    const pages = await drain(c, [ARM_A, ARM_B], 4)
    const seen = pages.flat().map((i) => i.id)
    const expected = [...a, ...b].sort((x, y) => Date.parse(y.minedAt) - Date.parse(x.minedAt)).map((i) => i.id)
    expect(seen).toEqual(expected)
    for (const page of pages.slice(0, -1)) expect(page.length).toBeGreaterThan(0)
  })

  it('does not lose rows mined in the same second as a page boundary', async () => {
    const a = [tx('a0', at(50)), tx('a1', at(50)), tx('a2', at(50)), tx('a3', at(40)), tx('a4', at(30))]
    const c = connector({ '0xa': a })
    const pages = await drain(c, [ARM_A], 2)
    expect(pages.flat().map((i) => i.id).sort()).toEqual(['a0', 'a1', 'a2', 'a3', 'a4'])
    expect(pages.flat()).toHaveLength(5)
  })

  it('reports an arm that failed and keeps reading the others', async () => {
    const c = connector({ '0xa': [tx('a1', at(50))], '0xb': [tx('b1', at(40))] }, ['0xb'])
    const feed = await readActivity(c, [ARM_A, ARM_B], { size: 10 })
    expect(feed.items.map((i) => i.id)).toEqual(['a1'])
    expect(feed.arms).toEqual([
      { walletId: 'a', address: '0xa', status: 'ok' },
      { walletId: 'b', address: '0xb', status: 'rate_limited' },
    ])
    // The failed arm has not been read, so there is more to ask for.
    expect(feed.cursor).not.toBeNull()
  })

  it('refuses a cursor it did not write', async () => {
    const c = connector({})
    await expect(readActivity(c, [ARM_A], { size: 5, cursor: 'nonsense' })).rejects.toThrow(PortfolioError)
  })

  it('starts an arm the cursor does not know from the top', async () => {
    const c = connector({ '0xa': [tx('a1', at(50))], '0xb': [tx('b1', at(40))] })
    const first = await readActivity(c, [ARM_A], { size: 5 })
    expect(first.cursor).toBeNull()
    const cursor = encodeCursor({ v: 1, arms: { a: 'done' } })
    const feed = await readActivity(c, [ARM_A, ARM_B], { size: 5, cursor })
    expect(feed.items.map((i) => i.id)).toEqual(['b1'])
  })

  it('passes the chain filter through', async () => {
    const c = connector({ '0xa': [tx('a1', at(50)), tx('a2', at(40), { chainId: 'eip155:1' })] })
    const feed = await readActivity(c, [ARM_A], { size: 5, chainId: 'eip155:1' })
    expect(feed.items.map((i) => i.id)).toEqual(['a2'])
  })
})

describe('the cursor', () => {
  it('round-trips', () => {
    const cursor = { v: 1 as const, arms: { a: { before: at(5), seen: ['x'] }, b: 'done' as const } }
    expect(decodeCursor(encodeCursor(cursor))).toEqual(cursor)
  })

  it('rejects shapes that are not a cursor', () => {
    expect(decodeCursor('')).toBeNull()
    expect(decodeCursor(Buffer.from('{"v":2,"arms":{}}').toString('base64url'))).toBeNull()
    expect(decodeCursor(Buffer.from('{"v":1,"arms":{"a":{"before":"yesterday","seen":[]}}}').toString('base64url'))).toBeNull()
  })
})
