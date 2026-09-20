import { describe, expect, it } from 'vitest'
import type { ActivityRow, Transfer } from '@/lib/api'
import { KIND_FILTERS, approvalWords, counterparty, dayLabel, groupByDay, kindWord, legs, transferWords } from './activity'

const ME = '0x958543756a4c7ac6fb361f0efbfecd98e4d297db'
const LIFI = '0x1231deb6f5749ef6ce6943a275a1d3e7486f4eae'

const usdc = { kind: 'fungible' as const, symbol: 'USDC', name: 'USDC', iconUrl: null, verified: true }
const eth = { kind: 'fungible' as const, symbol: 'ETH', name: 'Ethereum', iconUrl: null, verified: true }

const transfer = (over: Partial<Transfer>): Transfer => ({
  direction: 'out',
  asset: eth,
  amount: '204000000000000',
  decimals: 18,
  value: 0.5,
  price: 2457,
  sender: ME,
  recipient: LIFI,
  ...over,
})

const row = (over: Partial<ActivityRow>): ActivityRow => ({
  id: 't',
  walletId: 'w',
  hash: '0xabc',
  chainId: 'eip155:8453',
  minedAt: '2026-09-11T12:06:51Z',
  block: 1,
  status: 'confirmed',
  kind: 'trade',
  from: ME,
  to: LIFI,
  fee: null,
  transfers: [],
  approvals: [],
  app: null,
  ...over,
})

describe('the words', () => {
  it('has a word for every kind, and every kind is behind some pill', () => {
    const covered = new Set(KIND_FILTERS.flatMap((f) => f.kinds))
    for (const kind of ['send', 'receive', 'trade', 'deposit', 'withdraw', 'approve', 'revoke', 'claim', 'mint', 'burn', 'execute', 'deploy', 'delegate', 'revoke_delegation', 'bid'] as const) {
      expect(kindWord(kind)).toBeTruthy()
      expect(covered.has(kind)).toBe(true)
    }
  })

  it('writes an amount with its symbol and never rounds it to nothing', () => {
    expect(transferWords(transfer({}))).toBe('0.000204 ETH')
    expect(transferWords(transfer({ amount: '1', decimals: 18 }))).toBe('<0.000000000000000001 ETH')
    expect(transferWords(transfer({ asset: { kind: 'nft', name: 'Uniswap - USDC/WETH', imageUrl: null, contract: '0x1', tokenId: '5' }, amount: '1', decimals: 0 }))).toBe('Uniswap - USDC/WETH')
  })

  it('reads an approval as an allowance', () => {
    expect(approvalWords({ asset: usdc, amount: '300000', decimals: 6, unlimited: false, spender: LIFI })).toBe('0.3 USDC')
    expect(approvalWords({ asset: usdc, amount: '1', decimals: 6, unlimited: true, spender: LIFI })).toBe('Unlimited USDC')
    expect(approvalWords({ asset: usdc, amount: '0', decimals: 6, unlimited: false, spender: LIFI })).toBe('No more USDC')
  })
})

describe('the legs', () => {
  it('splits what left from what arrived, and counts a self transfer as arriving', () => {
    const r = row({ transfers: [transfer({ direction: 'out' }), transfer({ direction: 'in', asset: usdc }), transfer({ direction: 'self' })] })
    expect(legs(r).out).toHaveLength(1)
    expect(legs(r).in).toHaveLength(2)
  })
})

describe('the counterparty', () => {
  it('names the app when there is one', () => {
    const r = row({ app: { name: 'LI.FI', iconUrl: 'i', contract: LIFI, method: null } })
    expect(counterparty(r, ME)).toEqual({ relation: 'via', label: 'LI.FI', address: LIFI, iconUrl: 'i' })
  })

  it('names the recipient of a send and the sender of a receive', () => {
    const to = '0x9f925f63561e3bf88c320125ff3fdb742a5f6464'
    const sent = row({ kind: 'send', transfers: [transfer({ recipient: to })] })
    expect(counterparty(sent, ME)).toMatchObject({ relation: 'to', address: to, label: '0x9f92…6464' })
    const got = row({ kind: 'receive', transfers: [transfer({ direction: 'in', sender: to, recipient: ME })] })
    expect(counterparty(got, ME)).toMatchObject({ relation: 'from', address: to })
  })

  it('falls back to the contract and its method, and says nothing for a wallet talking to itself', () => {
    const r = row({ kind: 'execute', app: { name: null, iconUrl: null, contract: LIFI, method: 'Exec Transaction' } })
    expect(counterparty(r, ME)).toMatchObject({ relation: 'with', label: 'Exec Transaction · 0x1231…4eae' })
    expect(counterparty(row({ to: ME.toUpperCase() }), ME)).toBeNull()
  })
})

describe('the days', () => {
  const noon = new Date(2026, 8, 12, 12).getTime()

  it('says today and yesterday, then the date, then the date with a year', () => {
    expect(dayLabel(new Date(2026, 8, 12, 1).toISOString(), noon)).toBe('Today')
    expect(dayLabel(new Date(2026, 8, 11, 23).toISOString(), noon)).toBe('Yesterday')
    expect(dayLabel(new Date(2026, 8, 1, 9).toISOString(), noon)).toBe('September 1')
    expect(dayLabel(new Date(2025, 11, 31, 9).toISOString(), noon)).toBe('December 31, 2025')
  })

  it('groups consecutive rows by day and keeps their order', () => {
    const rows = [
      row({ id: 'a', minedAt: new Date(2026, 8, 12, 10).toISOString() }),
      row({ id: 'b', minedAt: new Date(2026, 8, 12, 9).toISOString() }),
      row({ id: 'c', minedAt: new Date(2026, 8, 11, 9).toISOString() }),
    ]
    expect(groupByDay(rows, noon).map((g) => [g.label, g.rows.map((r) => r.id)])).toEqual([
      ['Today', ['a', 'b']],
      ['Yesterday', ['c']],
    ])
  })
})
