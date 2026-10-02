import { expect, test } from 'claude-code/testing'

import type { On } from 'claude-code'

import type { CapturedPlan } from '../types'

/**
 * A test's hooks stand for the engine, so the session's state is held here:
 * what the plugin wrote last is what it reads back, and what the test checks.
 */
function sessionState(on: On) {
  const held: { value: CapturedPlan | null | undefined; version: number } = { value: undefined, version: 0 }
  on('state.get', () => ({ value: { value: held.value, version: held.version } }))
  on('state.set', (_$, e) => {
    held.value = e.value as CapturedPlan | null
    held.version += 1
    return { value: { isSet: true as const, version: held.version } }
  })
  return held
}

const READY = {
  planId: '7f0c1a52-1111-4222-8333-444455556666',
  status: 'awaiting_review',
  summary: 'Swap 50 USDT for NVDAB on BNB Chain',
  expiresAt: '2026-10-02T10:05:00.000Z',
  reviewUrl: 'https://ottopus.xyz/review/abc',
}

test('remembers the plan a prepare call returned and passes the result through', async ($, on) => {
  const state = sessionState(on)
  on('tool.call', { tool: 'mcp__otto__prepare_trade' }, () => ({ result: JSON.stringify(READY) }))
  const ran = await $.tool.call({ tool: 'mcp__otto__prepare_trade', from: 'a', to: 'b' })
  expect(ran.result).toBe(JSON.stringify(READY))
  const { value } = state
  expect(value?.planId).toBe(READY.planId)
  expect(value?.server).toBe('otto')
  expect(value?.reviewUrl).toBe(READY.reviewUrl)
})

test('a newer plan replaces the one before it', async ($, on) => {
  const state = sessionState(on)
  let id = 'first'
  on('tool.call', { tool: 'mcp__otto__prepare_transfer' }, () => ({ result: JSON.stringify({ ...READY, planId: id }) }))
  await $.tool.call({ tool: 'mcp__otto__prepare_transfer' })
  id = 'second'
  await $.tool.call({ tool: 'mcp__otto__prepare_transfer' })
  expect(state.value?.planId).toBe('second')
})

test('a refusal in prose and other tools leave nothing behind', async ($, on) => {
  const state = sessionState(on)
  on('tool.call', { tool: 'mcp__otto__prepare_trade' }, () => ({ result: 'No route was found:\n- no liquidity' }))
  on('tool.call', { tool: 'mcp__otto__get_plan' }, () => ({ result: JSON.stringify(READY) }))
  await $.tool.call({ tool: 'mcp__otto__prepare_trade' })
  await $.tool.call({ tool: 'mcp__otto__get_plan' })
  expect(state.value ?? null).toBe(null)
})
