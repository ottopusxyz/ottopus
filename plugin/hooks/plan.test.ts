import { expect, test } from 'claude-code/testing'

import { capturePlan, prepareCall } from './plan'

const CALL = { server: 'claude_ai_Ottopus', tool: 'prepare_trade' } as const

const READY = {
  planId: '7f0c1a52-1111-4222-8333-444455556666',
  status: 'awaiting_review',
  trade: 'swap',
  summary: 'Swap 50 USDT for NVDAB on BNB Chain',
  recommendedAccount: 'eip155:56:0x1111111111111111111111111111111111111111',
  reason: 'Main holds enough USDT and BNB for gas.',
  route: 'PancakeSwap via LI.FI',
  expectedOut: '0.2841 NVDAB',
  minOut: '0.2813 NVDAB',
  feesUsd: '0.12',
  warnings: [{ severity: 'warn', code: 'premium', message: 'Trading 1.2% above the share price.' }],
  expiresAt: '2026-10-02T10:05:00.000Z',
  reviewUrl: 'https://ottopus.xyz/review/abc',
}

test('reads the server and the tool off a prepare call, whatever the server is called', () => {
  expect(prepareCall('mcp__claude_ai_Ottopus__prepare_trade')).toEqual(CALL)
  expect(prepareCall('mcp__otto__prepare_custom')).toEqual({ server: 'otto', tool: 'prepare_custom' })
  expect(prepareCall('mcp__claude_ai_Ottopus__get_plan')).toBe(null)
  expect(prepareCall('Bash')).toBe(null)
})

test('captures a ready plan from the JSON the model read', () => {
  const plan = capturePlan(CALL, JSON.stringify(READY))
  expect(plan).toEqual({
    ...CALL,
    planId: READY.planId,
    status: 'awaiting_review',
    summary: READY.summary,
    reason: READY.reason,
    account: READY.recommendedAccount,
    route: READY.route,
    expectedOut: READY.expectedOut,
    minOut: READY.minOut,
    feesUsd: READY.feesUsd,
    warnings: ['Trading 1.2% above the share price.'],
    reasons: [],
    expiresAt: READY.expiresAt,
    reviewUrl: READY.reviewUrl,
  })
})

test('a custom plan names its own account and has no route', () => {
  const { recommendedAccount, route: _route, reason: _reason, ...rest } = READY
  const plan = capturePlan({ server: 'otto', tool: 'prepare_custom' }, { ...rest, account: recommendedAccount })
  expect(plan?.account).toBe(recommendedAccount)
  expect(plan?.route).toBe(null)
  expect(plan?.reason).toBe(null)
})

test('a blocked plan carries its reasons and never a link', () => {
  const plan = capturePlan(CALL, {
    planId: READY.planId,
    status: 'blocked',
    summary: READY.summary,
    reasons: ['The approval does not match the router call.'],
    reviewUrl: 'https://ottopus.xyz/review/should-not-be-kept',
  })
  expect(plan?.status).toBe('blocked')
  expect(plan?.reasons).toEqual(['The approval does not match the router call.'])
  expect(plan?.reviewUrl).toBe(null)
})

test('keeps a status it has never heard of', () => {
  expect(capturePlan(CALL, { ...READY, status: 'approved' })?.status).toBe('approved')
})

test('anything that is not a plan is null', () => {
  expect(capturePlan(CALL, 'No linked wallet can make this trade:\n- none holds USDT')).toBe(null)
  expect(capturePlan(CALL, JSON.stringify({ ticker: 'NVDA' }))).toBe(null)
  expect(capturePlan(CALL, undefined)).toBe(null)
  expect(capturePlan(CALL, '[1,2]')).toBe(null)
})

test('holds nothing a wallet could send, even when the result carries it', () => {
  const plan = capturePlan(CALL, { ...READY, calls: [{ to: '0xabc', data: '0xdeadbeef', value: '0' }] })
  expect(JSON.stringify(plan)).not.toContain('deadbeef')
})
