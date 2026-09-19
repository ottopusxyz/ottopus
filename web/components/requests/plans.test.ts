import { describe, expect, it } from 'vitest'
import type { PlanSummary } from '@/lib/api'
import { effectiveStatus, filterPlans, kindWord, sortPlans, statusCounts, walletOptions, whatLine } from './plans'

const row = (over: Partial<PlanSummary>): PlanSummary => ({
  id: 'p',
  version: 1,
  status: 'awaiting_review',
  kind: 'transfer',
  summary: 's',
  reason: 'r',
  account: { caip10: 'eip155:8453:0x0000000000000000000000000000000000000001', label: 'Main' },
  chainId: 'eip155:8453',
  asset: null,
  toAsset: null,
  recipient: null,
  blockedReason: null,
  createdVia: 'agent',
  expiresAt: '2026-09-10T12:15:00Z',
  createdAt: '2026-09-10T12:00:00Z',
  statusAt: '2026-09-10T12:00:00Z',
  assetIconUrl: null,
  chainIconUrl: null,
  valueUsd: null,
  wallet: null,
  ...over,
})

const NOW = Date.parse('2026-09-10T12:05:00Z')

describe('order', () => {
  it('keeps waiting-on-you first, then newest first, whatever the service sent', () => {
    const rows = [
      row({ id: 'old-done', status: 'confirmed', createdAt: '2026-09-09T10:00:00Z' }),
      row({ id: 'new-done', status: 'cancelled', createdAt: '2026-09-10T11:00:00Z' }),
      row({ id: 'old-wait', status: 'awaiting_signature', createdAt: '2026-09-10T09:00:00Z' }),
      row({ id: 'new-wait', createdAt: '2026-09-10T12:00:00Z' }),
    ]
    expect(sortPlans(rows, NOW).map((r) => r.id)).toEqual(['new-wait', 'old-wait', 'new-done', 'old-done'])
  })

  it('demotes a row the moment its clock passes', () => {
    const rows = [row({ id: 'stale', expiresAt: '2026-09-10T12:01:00Z', createdAt: '2026-09-10T12:00:00Z' }), row({ id: 'live', createdAt: '2026-09-10T11:00:00Z' })]
    expect(sortPlans(rows, NOW).map((r) => r.id)).toEqual(['live', 'stale'])
    expect(effectiveStatus(rows[0]!, NOW)).toBe('expired')
  })
})

describe('filters', () => {
  const rows = [
    row({ id: 'a' }),
    row({ id: 'b', status: 'confirmed' }),
    row({ id: 'c', status: 'blocked', account: { caip10: 'eip155:8453:0x0000000000000000000000000000000000000002' } }),
    // The same wallet as 'a' and 'b', on another chain: one option, not two.
    row({ id: 'd', status: 'confirmed', account: { caip10: 'eip155:56:0x0000000000000000000000000000000000000001', label: 'Main' }, chainId: 'eip155:56' }),
  ]

  it('counts each status present, in the pill order', () => {
    expect(statusCounts(rows, NOW)).toEqual([
      { status: 'awaiting_review', count: 1 },
      { status: 'confirmed', count: 2 },
      { status: 'blocked', count: 1 },
    ])
  })

  it('offers each wallet once across chains, with its label and count, busiest first', () => {
    expect(walletOptions(rows)).toEqual([
      { address: '0x0000000000000000000000000000000000000001', label: 'Main', count: 3, walletType: null },
      { address: '0x0000000000000000000000000000000000000002', label: '0x0000…0002', count: 1, walletType: null },
    ])
  })

  it('narrows by status and wallet together, the wallet meaning every chain it was used on', () => {
    expect(filterPlans(rows, 'confirmed', 'all', NOW).map((r) => r.id)).toEqual(['b', 'd'])
    expect(filterPlans(rows, 'all', '0x0000000000000000000000000000000000000001', NOW).map((r) => r.id)).toEqual(['a', 'b', 'd'])
    expect(filterPlans(rows, 'all', '0x0000000000000000000000000000000000000002', NOW).map((r) => r.id)).toEqual(['c'])
    expect(filterPlans(rows, 'blocked', '0x0000000000000000000000000000000000000001', NOW)).toEqual([])
  })

  it('names the verb', () => {
    expect(kindWord('transfer')).toBe('Send')
    expect(kindWord('swap')).toBe('Swap')
    expect(kindWord('custom')).toBe('Custom')
  })
})

describe('the second line', () => {
  const usdc = { id: 'eip155:8453/erc20:0x8335', amount: '500000000', symbol: 'USDC', decimals: 6 }
  it('names the recipient for a transfer', () => {
    expect(whatLine(row({ asset: usdc, recipient: { address: '0x67d29520c6f9579fe4b32dcba346620846ef98d2', name: 'koshik.eth' } }))).toBe('USDC → koshik.eth')
    expect(whatLine(row({ asset: usdc, recipient: { address: '0x67d29520c6f9579fe4b32dcba346620846ef98d2', name: null } }))).toBe('USDC → 0x67d2…98d2')
  })
  it('names the other side for a trade', () => {
    expect(whatLine(row({ kind: 'swap', asset: usdc, toAsset: { id: 'eip155:8453/slip44:60', symbol: 'ETH' } }))).toBe('USDC → ETH')
    expect(whatLine(row({ kind: 'swap', asset: usdc, toAsset: { id: 'x', symbol: null } }))).toBe('USDC → a token')
  })
  it('falls back to the summary for a custom plan', () => {
    expect(whatLine(row({ kind: 'custom', summary: 'Add liquidity', asset: usdc }))).toBe('Add liquidity')
  })
})
