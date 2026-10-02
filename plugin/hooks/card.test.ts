import { expect, test } from 'claude-code/testing'

import type { CapturedPlan } from '../types'
import { cardOf, clockTime, timeLeft } from './card'

const READY: CapturedPlan = {
  server: 'otto',
  tool: 'prepare_trade',
  planId: '7f0c1a52-1111-4222-8333-444455556666',
  status: 'awaiting_review',
  summary: 'Swap 50 USDT for NVDAB on BNB Chain',
  reason: 'Main holds enough USDT and BNB for gas.',
  account: 'eip155:56:0x1111111111111111111111111111111111112222',
  route: 'PancakeSwap via LI.FI',
  expectedOut: '0.2841 NVDAB',
  minOut: '0.2813 NVDAB',
  feesUsd: '0.12',
  warnings: ['Trading 1.2% above the share price.'],
  reasons: [],
  expiresAt: '2026-10-02T10:05:00.000Z',
  reviewUrl: 'https://ottopus.xyz/review/abc',
}

const BEFORE = Date.parse('2026-10-02T10:00:00.000Z')
const AFTER = Date.parse('2026-10-02T10:05:00.000Z')

test('nothing to show without a plan', () => {
  expect(cardOf(null, BEFORE)).toBe(null)
})

test('a ready plan shows its reason, route and fees, never the raw amounts, and links to the review page', () => {
  expect(cardOf(READY, BEFORE)).toEqual({
    tone: 'ready',
    title: 'Plan ready',
    summary: READY.summary,
    lines: [READY.reason, 'Route: PancakeSwap via LI.FI', 'Fees about $0.12'],
    warnings: READY.warnings,
    expiresAt: READY.expiresAt,
    link: { href: READY.reviewUrl, label: 'Review and sign' },
  })
})

test('a plan with no stated reason names its wallet, shortened', () => {
  const card = cardOf({ ...READY, reason: null, route: null, minOut: null, feesUsd: null }, BEFORE)
  expect(card?.lines).toEqual(['Wallet 0x1111…2222'])
})

test('a blocked plan shows why and offers no link', () => {
  const card = cardOf({ ...READY, status: 'blocked', reasons: ['The approval does not match the router call.'], reviewUrl: null }, BEFORE)
  expect(card?.tone).toBe('blocked')
  expect(card?.title).toBe('Plan refused')
  expect(card?.lines).toEqual(['The approval does not match the router call.'])
  expect(card?.link).toBe(null)
})

test('past its expiry a ready plan stops asking for a signature', () => {
  const card = cardOf(READY, AFTER)
  expect(card?.tone).toBe('ended')
  expect(card?.title).toBe('Plan expired')
  expect(card?.link?.label).toBe('Open plan')
  expect(card?.expiresAt).toBe(null)
})

test('a submitted plan is not expired by its quote running out', () => {
  const card = cardOf({ ...READY, status: 'submitted' }, AFTER)
  expect(card?.tone).toBe('ready')
  expect(card?.title).toBe('Plan submitted')
  expect(card?.link?.label).toBe('Open plan')
})

test('ended statuses read as ended; a status never heard of stays live', () => {
  expect(cardOf({ ...READY, status: 'confirmed' }, BEFORE)?.title).toBe('Plan confirmed')
  expect(cardOf({ ...READY, status: 'superseded' }, BEFORE)?.tone).toBe('ended')
  const approved = cardOf({ ...READY, status: 'approved' }, BEFORE)
  expect(approved?.tone).toBe('ready')
  expect(approved?.title).toBe('Plan approved')
})

test('an expiry reads as a wall-clock time, and nonsense as nothing', () => {
  expect(clockTime(READY.expiresAt!)).toMatch(/^\d\d:\d\d$/)
  expect(clockTime('soon')).toBe(null)
})

test('the time left counts down in minutes and seconds, and is nothing once over', () => {
  expect(timeLeft(READY.expiresAt!, BEFORE)).toBe('5:00')
  expect(timeLeft(READY.expiresAt!, AFTER - 61_500)).toBe('1:02')
  expect(timeLeft(READY.expiresAt!, AFTER - 1)).toBe('0:01')
  expect(timeLeft(READY.expiresAt!, AFTER)).toBe(null)
  expect(timeLeft('soon', BEFORE)).toBe(null)
})
