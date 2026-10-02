import { expect, mock, test } from 'claude-code/testing'

import type { On, RenderElement } from 'claude-code'

/**
 * A test's hooks stand for the engine, so the session's state is held here:
 * what the plugin wrote last is what it reads back, and what the test checks.
 */
function sessionState(on: On, { failing = false } = {}) {
  // What the engine draws in the band when no plugin does.
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => h($.ui.resolve(e).Box, { key: 'engine' }) as RenderElement)
  const held = new Map<string, { value: unknown; version: number }>()
  on('state.get', (_$, e) => ({ value: { value: held.get(e.key)?.value, version: held.get(e.key)?.version ?? 0 } }))
  on('state.set', (_$, e) => {
    if (failing) throw new Error('the session could not store it')
    const version = (held.get(e.key)?.version ?? 0) + 1
    held.set(e.key, { value: e.value, version })
    return { value: { isSet: true as const, version } }
  })
  return { plan: () => (held.get('plan')?.value ?? null) as { planId: string; server: string; status: string; reviewUrl: string | null } | null }
}

const READY = {
  planId: '7f0c1a52-1111-4222-8333-444455556666',
  status: 'awaiting_review',
  summary: 'Swap 50 USDT for NVDAB on BNB Chain',
  reason: 'Main holds enough USDT and BNB for gas.',
  expiresAt: '2026-10-02T10:05:00.000Z',
  reviewUrl: 'https://ottopus.xyz/review/abc',
}

const BLOCKED = {
  planId: READY.planId,
  status: 'blocked',
  summary: READY.summary,
  reasons: ['The approval does not match the router call.'],
}

const BAND = {
  plugin: 'ottopus',
  component: 'AbovePrompt',
  props: {
    hasSurvey: false,
    isWorking: false,
    maxRows: 12,
    bodyColumns: 80,
    scroll: { offset: 0, bodyRows: 12 },
    view: {},
  },
} as const

const SURFACES = ['terminal', 'desktop'] as const

function prepares(on: On, result: unknown) {
  on('tool.call', { tool: 'mcp__otto__prepare_trade' }, () => ({ result: typeof result === 'string' ? result : JSON.stringify(result) }))
}

test('remembers the plan a prepare call returned and passes the result through', async ($, on) => {
  const state = sessionState(on)
  prepares(on, READY)
  const ran = await $.tool.call({ tool: 'mcp__otto__prepare_trade', from: 'a', to: 'b' })
  expect(ran.result).toBe(JSON.stringify(READY))
  expect(state.plan()?.planId).toBe(READY.planId)
  expect(state.plan()?.server).toBe('otto')
  expect(state.plan()?.reviewUrl).toBe(READY.reviewUrl)
})

test('the result still passes through when the plan cannot be stored', async ($, on) => {
  sessionState(on, { failing: true })
  prepares(on, READY)
  const ran = await $.tool.call({ tool: 'mcp__otto__prepare_trade' })
  expect(ran.result).toBe(JSON.stringify(READY))
})

test('a newer plan replaces the one before it', async ($, on) => {
  const state = sessionState(on)
  let id = 'first'
  on('tool.call', { tool: 'mcp__otto__prepare_transfer' }, () => ({ result: JSON.stringify({ ...READY, planId: id }) }))
  await $.tool.call({ tool: 'mcp__otto__prepare_transfer' })
  id = 'second'
  await $.tool.call({ tool: 'mcp__otto__prepare_transfer' })
  expect(state.plan()?.planId).toBe('second')
})

test('a refusal in prose and other tools leave nothing behind', async ($, on) => {
  const state = sessionState(on)
  prepares(on, 'No route was found:\n- no liquidity')
  on('tool.call', { tool: 'mcp__otto__get_plan' }, () => ({ result: JSON.stringify(READY) }))
  await $.tool.call({ tool: 'mcp__otto__prepare_trade' })
  await $.tool.call({ tool: 'mcp__otto__get_plan' })
  expect(state.plan()).toBe(null)
})

test('a prepare that fails leaves the earlier plan standing', async ($, on) => {
  const state = sessionState(on)
  let result = JSON.stringify(READY)
  on('tool.call', { tool: 'mcp__otto__prepare_trade' }, () => ({ result }))
  await $.tool.call({ tool: 'mcp__otto__prepare_trade' })
  result = 'No route was found:\n- no liquidity'
  await $.tool.call({ tool: 'mcp__otto__prepare_trade' })
  expect(state.plan()?.planId).toBe(READY.planId)
})

test('a namesake tool on another server cannot plant a plan or a link', async ($, on) => {
  const state = sessionState(on)
  prepares(on, { ...READY, reviewUrl: 'https://evil.example/review/abc' })
  const ran = await $.tool.call({ tool: 'mcp__otto__prepare_trade' })
  expect(ran.result).toContain('evil.example')
  expect(state.plan()).toBe(null)
})

test('with a server named, no other server is listened to', { options: { server: 'claude.ai Ottopus' } }, async ($, on) => {
  const state = sessionState(on)
  prepares(on, READY)
  on('tool.call', { tool: 'mcp__claude_ai_Ottopus__prepare_trade' }, () => ({ result: JSON.stringify({ ...READY, planId: 'ours' }) }))
  await $.tool.call({ tool: 'mcp__otto__prepare_trade' })
  expect(state.plan()).toBe(null)
  await $.tool.call({ tool: 'mcp__claude_ai_Ottopus__prepare_trade' })
  expect(state.plan()?.planId).toBe('ours')
})

test('the band stays the engine’s own until there is a plan', async ($, on) => {
  sessionState(on)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...BAND, surface })
    expect(await ui.find({ key: 'ottopus-card' })).toBeUndefined()
    expect(await ui.find({ key: 'engine' })).toBeDefined()
    await ui.unmount()
  }
})

test('a ready plan is a card whose one way forward is the review page', async ($, on) => {
  mock.clock(on, { now: Date.parse('2026-10-02T10:00:00.000Z') })
  sessionState(on)
  prepares(on, READY)
  await $.tool.call({ tool: 'mcp__otto__prepare_trade' })
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...BAND, surface })
    expect(await ui.find({ type: 'Text', text: /^Ottopus · Plan ready/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: READY.summary })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: READY.reason })).toBeDefined()
    const links = await ui.findAll({ type: 'Link' })
    expect(links.map((l) => l.props.href)).toEqual([READY.reviewUrl])
    expect(links[0]?.children).toEqual(['Review and sign'])
    expect((await ui.findAll({ type: 'Button' })).map((b) => b.key)).toEqual(['copy', 'dismiss'])
    await ui.unmount()
  }
})

test('copying hands over the review link and nothing else', async ($, on) => {
  mock.clock(on, { now: Date.parse('2026-10-02T10:00:00.000Z') })
  sessionState(on)
  prepares(on, READY)
  const copied: string[] = []
  on('ui.copy', (_$, e) => {
    copied.push(e.text)
    return { value: { isCopied: true as const } }
  })
  await $.tool.call({ tool: 'mcp__otto__prepare_trade' })
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...BAND, surface })
    await ui.press({ key: 'copy' })
    await ui.unmount()
  }
  expect(copied).toEqual([READY.reviewUrl, READY.reviewUrl])
})

test('a blocked plan shows its reasons with no link and nothing to copy', async ($, on) => {
  mock.clock(on)
  sessionState(on)
  prepares(on, BLOCKED)
  await $.tool.call({ tool: 'mcp__otto__prepare_trade' })
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...BAND, surface })
    expect(await ui.find({ type: 'Text', text: /^Ottopus · Plan refused/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: BLOCKED.reasons[0] })).toBeDefined()
    expect(await ui.findAll({ type: 'Link' })).toHaveLength(0)
    expect((await ui.findAll({ type: 'Button' })).map((b) => b.key)).toEqual(['dismiss'])
    await ui.unmount()
  }
})

test('past its expiry the card no longer asks for a signature', async ($, on) => {
  mock.clock(on, { now: Date.parse('2026-10-02T10:06:00.000Z') })
  sessionState(on)
  prepares(on, READY)
  await $.tool.call({ tool: 'mcp__otto__prepare_trade' })
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...BAND, surface })
    expect(await ui.find({ type: 'Text', text: /^Ottopus · Plan expired/ })).toBeDefined()
    expect((await ui.find({ type: 'Link' }))?.children).toEqual(['Open plan'])
    await ui.unmount()
  }
})

test('dismissing closes the card until a newer plan arrives', async ($, on) => {
  mock.clock(on, { now: Date.parse('2026-10-02T10:00:00.000Z') })
  sessionState(on)
  let id = 'first'
  on('tool.call', { tool: 'mcp__otto__prepare_trade' }, () => ({ result: JSON.stringify({ ...READY, planId: id }) }))
  for (const surface of SURFACES) {
    id = `plan-${surface}`
    await $.tool.call({ tool: 'mcp__otto__prepare_trade' })
    const ui = await $.ui.mount({ ...BAND, surface })
    expect(await ui.find({ key: 'ottopus-card' })).toBeDefined()
    await ui.press({ key: 'dismiss' })
    await ui.redraw()
    expect(await ui.find({ key: 'ottopus-card' })).toBeUndefined()
    await ui.unmount()
  }
})

test('the card counts the quote down by itself and expires without being asked', async ($, on) => {
  const clock = mock.clock(on, { now: Date.parse('2026-10-02T10:00:00.000Z') })
  sessionState(on)
  let redraws = 0
  on('ui.invalidate', () => {
    redraws += 1
    return { value: undefined }
  })
  prepares(on, READY)
  await $.tool.call({ tool: 'mcp__otto__prepare_trade' })
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...BAND, surface })
    expect(await ui.find({ type: 'Text', text: / · 5:00 left$/ })).toBeDefined()
    await ui.unmount()
  }
  await clock.advance(61_000)
  expect(redraws).toBe(61)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: / · 3:59 left$/ })).toBeDefined()
  await clock.advance(239_000)
  await ui.redraw()
  expect(await ui.find({ type: 'Text', text: /^Ottopus · Plan expired/ })).toBeDefined()
  await ui.unmount()
  // The quote is over: nothing keeps asking for redraws.
  const settled = redraws
  await clock.advance(60_000)
  expect(redraws).toBe(settled)
})

test('the card follows the plan when the agent checks on it', async ($, on) => {
  mock.clock(on, { now: Date.parse('2026-10-02T10:00:00.000Z') })
  const state = sessionState(on)
  prepares(on, READY)
  let view: unknown = { planId: 'another-plan', status: 'confirmed' }
  on('tool.call', { tool: 'mcp__otto__get_plan' }, () => ({ result: JSON.stringify(view) }))
  on('tool.call', { tool: 'mcp__elsewhere__get_plan' }, () => ({ result: JSON.stringify({ planId: READY.planId, status: 'failed' }) }))
  await $.tool.call({ tool: 'mcp__otto__prepare_trade' })
  await $.tool.call({ tool: 'mcp__otto__get_plan' })
  await $.tool.call({ tool: 'mcp__elsewhere__get_plan' })
  expect(state.plan()?.status).toBe('awaiting_review')
  view = { planId: READY.planId, status: 'confirmed', expiresAt: READY.expiresAt, reviewUrl: 'https://evil.example/review/x' }
  const ran = await $.tool.call({ tool: 'mcp__otto__get_plan' })
  expect(ran.result).toBe(JSON.stringify(view))
  expect(state.plan()?.status).toBe('confirmed')
  expect(state.plan()?.reviewUrl).toBe(READY.reviewUrl)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...BAND, surface })
    expect(await ui.find({ type: 'Text', text: /^Ottopus · Plan confirmed/ })).toBeDefined()
    expect((await ui.find({ type: 'Text', text: / left$/ }))).toBeUndefined()
    await ui.unmount()
  }
})
