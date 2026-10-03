import { expect, test } from 'claude-code/testing'

import { capturePlan as capture, followPlan, prepareCall, statusCall, trustedReviewUrl } from './plan'
import type { Trust } from './plan'

const CALL = { server: 'claude_ai_Ottopus', tool: 'prepare_trade' } as const

const TRUST: Trust = { reviewOrigin: 'https://ottopus.xyz', server: null }

const capturePlan = (call: Parameters<typeof capture>[0], result: unknown) => capture(call, result, TRUST)

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

test('a plan whose link leads anywhere but the review page is not a plan', () => {
  expect(capturePlan(CALL, { ...READY, reviewUrl: 'https://ottopus.xyz.evil.example/review/abc' })).toBe(null)
  expect(capturePlan(CALL, { ...READY, reviewUrl: 'https://ottopus.xyz/login?next=abc' })).toBe(null)
  expect(capturePlan(CALL, { ...READY, reviewUrl: 'http://ottopus.xyz/review/abc' })).toBe(null)
  expect(capturePlan(CALL, { ...READY, reviewUrl: undefined })).toBe(null)
})

test('the review origin can be moved for a self-hosted Ottopus', () => {
  expect(trustedReviewUrl('http://localhost:3000/review/abc', 'http://localhost:3000')).toBe('http://localhost:3000/review/abc')
  expect(trustedReviewUrl('https://ottopus.xyz/review/abc', 'http://localhost:3000')).toBe(null)
  expect(trustedReviewUrl('https://user@ottopus.xyz/review/abc', 'https://ottopus.xyz')).toBe(null)
})

test('a named server is the only one listened to, however its name is spelled', () => {
  const named: Trust = { ...TRUST, server: 'claude.ai Ottopus' }
  expect(prepareCall('mcp__claude_ai_Ottopus__prepare_trade', named)).toEqual(CALL)
  expect(prepareCall('mcp__other__prepare_trade', named)).toBe(null)
})

test('a status check moves the plan it is about, and only its status and expiry', () => {
  const plan = capturePlan(CALL, READY)!
  expect(statusCall('mcp__claude_ai_Ottopus__get_plan')).toBe('claude_ai_Ottopus')
  expect(statusCall('mcp__claude_ai_Ottopus__cancel_plan')).toBe('claude_ai_Ottopus')
  expect(statusCall('mcp__claude_ai_Ottopus__prepare_trade')).toBe(null)
  const view = { planId: READY.planId, status: 'confirmed', summary: 'Something else', reviewUrl: 'https://evil.example/review/x', expiresAt: READY.expiresAt }
  expect(followPlan(plan, CALL.server, JSON.stringify(view))).toEqual({ ...plan, status: 'confirmed' })
})

test('a status check about another plan, from another server, or with no news changes nothing', () => {
  const plan = capturePlan(CALL, READY)!
  expect(followPlan(plan, CALL.server, { planId: 'another', status: 'confirmed' })).toBe(null)
  expect(followPlan(plan, 'other', { planId: READY.planId, status: 'confirmed' })).toBe(null)
  expect(followPlan(plan, CALL.server, { planId: READY.planId, status: READY.status, expiresAt: READY.expiresAt })).toBe(null)
  expect(followPlan(plan, CALL.server, 'No plan with that id.')).toBe(null)
})

test('a status check notes the chain and the transaction, and builds no link from the result', () => {
  const plan = capturePlan(CALL, READY)!
  const txHash = `0x${'ab'.repeat(32)}`
  const view = { planId: READY.planId, status: 'confirmed', chain: { id: 'eip155:56', name: 'BNB Chain' }, txHash, explorerUrl: 'https://evil.example/tx/1' }
  const followed = followPlan(plan, CALL.server, view)
  expect(followed).toEqual({ ...plan, status: 'confirmed', chainId: 'eip155:56', txHash })
  expect(JSON.stringify(followed)).not.toContain('evil.example')
  // A hash that is not one is dropped; the status still moves.
  expect(followPlan(plan, CALL.server, { ...view, txHash: 'https://evil.example' })).toEqual({ ...plan, status: 'confirmed' })
  // The hash arriving is news even when the status has not moved.
  const sent = { ...plan, status: 'submitted' }
  expect(followPlan(sent, CALL.server, { ...view, status: 'submitted' })?.txHash).toBe(txHash)
})
