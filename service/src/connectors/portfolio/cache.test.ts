import { describe, expect, it, vi } from 'vitest'
import { cached } from './cache.js'
import { PortfolioError, type AccountPosition, type PortfolioConnector } from './types.js'

const ACCOUNT = { namespace: 'eip155', address: '0xaa' }

function position(amount = '1'): AccountPosition {
  return {
    assetId: 'eip155:8453/slip44:60',
    chainId: 'eip155:8453',
    asset: { symbol: 'ETH', name: 'Ethereum', decimals: 18, iconUrl: null, verified: true },
    positionType: 'wallet',
    amount,
    value: 1,
    price: 1,
    change1d: 0,
    protocol: null,
    groupId: null,
  }
}

function counting(answer: () => Promise<AccountPosition[]>): PortfolioConnector & { calls: number } {
  const connector = {
    provider: 'fake',
    calls: 0,
    async positionsFor() {
      connector.calls++
      return answer()
    },
    chainName: (chainId: string) => (chainId === 'eip155:8453' ? 'Base' : null),
  }
  return connector
}

describe('a short memory in front of the provider', () => {
  it('reads once inside the TTL', async () => {
    const inner = counting(async () => [position()])
    const clock = { t: 0 }
    const connector = cached(inner, { ttlMs: 1000, now: () => clock.t })

    await connector.positionsFor(ACCOUNT)
    clock.t = 999
    await connector.positionsFor(ACCOUNT)

    expect(inner.calls).toBe(1)
  })

  it('reads again once the TTL is past', async () => {
    const inner = counting(async () => [position()])
    const clock = { t: 0 }
    const connector = cached(inner, { ttlMs: 1000, now: () => clock.t })

    await connector.positionsFor(ACCOUNT)
    clock.t = 1001
    await connector.positionsFor(ACCOUNT)

    expect(inner.calls).toBe(2)
  })

  it('keeps accounts apart', async () => {
    const inner = counting(async () => [position()])
    const connector = cached(inner, { ttlMs: 1000 })

    await connector.positionsFor(ACCOUNT)
    await connector.positionsFor({ namespace: 'eip155', address: '0xbb' })

    expect(inner.calls).toBe(2)
  })

  it('does not treat a checksummed address as a different arm', async () => {
    const inner = counting(async () => [position()])
    const connector = cached(inner, { ttlMs: 1000 })

    await connector.positionsFor({ namespace: 'eip155', address: '0xAbC' })
    await connector.positionsFor({ namespace: 'eip155', address: '0xabc' })

    expect(inner.calls).toBe(1)
  })
})

describe('two callers at once make one call', () => {
  it('coalesces reads in flight', async () => {
    let release: (() => void) | undefined
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const inner = counting(async () => {
      await gate
      return [position()]
    })
    const connector = cached(inner, { ttlMs: 1000 })

    const both = Promise.all([connector.positionsFor(ACCOUNT), connector.positionsFor(ACCOUNT)])
    release!()
    const [a, b] = await both

    expect(inner.calls).toBe(1)
    expect(a).toEqual(b)
  })

  it('coalesces a failure too, without remembering it', async () => {
    let fail = true
    const inner = counting(async () => {
      if (fail) throw new PortfolioError('unavailable', 'down')
      return [position('7')]
    })
    const connector = cached(inner, { ttlMs: 60_000 })

    const results = await Promise.allSettled([
      connector.positionsFor(ACCOUNT),
      connector.positionsFor(ACCOUNT),
    ])
    expect(results.every((r) => r.status === 'rejected')).toBe(true)
    expect(inner.calls).toBe(1)

    // An arm that failed because the vendor blinked must be retried on the next
    // page load, not held wrong for a minute.
    fail = false
    await expect(connector.positionsFor(ACCOUNT)).resolves.toEqual([position('7')])
    expect(inner.calls).toBe(2)
  })
})

describe('the cache stays bounded', () => {
  it('forgets the oldest entries rather than growing without limit', async () => {
    const inner = counting(async () => [position()])
    const connector = cached(inner, { ttlMs: 60_000, maxEntries: 2 })

    for (const address of ['0x1', '0x2', '0x3']) {
      await connector.positionsFor({ namespace: 'eip155', address })
    }
    expect(inner.calls).toBe(3)

    // 0x1 was evicted; 0x3 is still remembered.
    await connector.positionsFor({ namespace: 'eip155', address: '0x3' })
    expect(inner.calls).toBe(3)

    await connector.positionsFor({ namespace: 'eip155', address: '0x1' })
    expect(inner.calls).toBe(4)
  })
})

describe('the wrapper is still the same connector', () => {
  it('passes the provider name and chain names through', () => {
    const connector = cached(counting(async () => []))
    expect(connector.provider).toBe('fake')
    expect(connector.chainName?.('eip155:8453')).toBe('Base')
  })

  it('has no chainName when the wrapped connector has none', () => {
    const bare: PortfolioConnector = { provider: 'bare', positionsFor: async () => [] }
    expect(cached(bare).chainName).toBeUndefined()
  })
})
