import { expect, mock, test } from 'claude-code/testing'

import type { On, RenderElement } from 'claude-code'

import { BURST_MS } from './card'
import { painted } from './painted'

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
    expect(await ui.find({ type: 'Text', text: /^Main holds enough USDT and BNB for gas$/ })).toBeDefined()
    const links = await ui.findAll({ type: 'Link' })
    // One link and nothing to press: the surface opens it, the plugin runs nothing.
    expect(links.map((l) => l.props.href)).toEqual([READY.reviewUrl])
    expect(await ui.findAll({ type: 'Button' })).toHaveLength(0)
    // Drawn as a button: a navy label on a solid fill.
    const label = await ui.find({ type: 'Text', text: '  Review and sign  ' })
    expect(label?.props).toMatchObject({ backgroundColor: '#5B9BFF', color: '#16213E', bold: true })
    await ui.unmount()
  }
})

test('a blocked plan shows its reasons with no link and nothing to press', async ($, on) => {
  mock.clock(on)
  sessionState(on)
  prepares(on, BLOCKED)
  await $.tool.call({ tool: 'mcp__otto__prepare_trade' })
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...BAND, surface })
    expect(await ui.find({ type: 'Text', text: /^Ottopus · Plan refused/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: BLOCKED.reasons[0] })).toBeDefined()
    expect(await ui.findAll({ type: 'Link' })).toHaveLength(0)
    expect(await ui.findAll({ type: 'Button' })).toHaveLength(0)
    expect(await ui.find({ type: 'Text', text: /ctrl\+x tab/ })).toBeUndefined()
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
    expect((await ui.find({ type: 'Link' }))?.props.label).toBe('Open plan')
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

test('a ready card is blue and still, and turns amber only in the last half minute', async ($, on) => {
  const clock = mock.clock(on, { now: Date.parse('2026-10-02T10:04:00.000Z') })
  sessionState(on)
  prepares(on, READY)
  await $.tool.call({ tool: 'mcp__otto__prepare_trade' })
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect((await ui.find({ key: 'ottopus-card' }))?.props.borderColor).toBe('blue')
  expect((await ui.find({ type: 'Text', text: '●' }))?.props.color).toBe('blue')
  expect(await ui.find({ type: 'Text', text: / · 1:00 left$/ })).toBeDefined()
  // The clock has a line of its own under the title, ending in the bar, and no number beside it.
  expect(await ui.find({ type: 'Text', text: /^Ottopus · Plan ready$/ })).toBeDefined()
  expect(await ui.find({ key: 'ottopus-clock' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /%/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /sign soon/ })).toBeUndefined()
  // The bar is painted cells: full and plan blue with a minute to go.
  const full = painted((await ui.find({ key: 'ottopus-meter' }))?.props.cells)
  expect(full.glyphs).toBe('█'.repeat(20))
  expect(new Set(full.colors)).toEqual(new Set([0x5b9bff]))
  await clock.advance(42_000)
  await ui.redraw()
  expect((await ui.find({ key: 'ottopus-card' }))?.props.borderColor).toBe('yellow')
  expect((await ui.find({ type: 'Text', text: '  Review and sign  ' }))?.props.backgroundColor).toBe('#F5A524')
  // The bar drains with the clock, an eighth of a cell at a time, and warms up with it.
  const late = painted((await ui.find({ key: 'ottopus-meter' }))?.props.cells)
  expect(late.glyphs).toBe('█'.repeat(6) + ' '.repeat(14))
  expect(new Set(late.colors)).toEqual(new Set([0xf5a524]))
  // The status keeps its colour; only the clock and the border warm up.
  expect((await ui.find({ type: 'Text', text: '●' }))?.props.color).toBe('blue')
  expect((await ui.find({ type: 'Text', text: /^\s*· 0:18 left · sign soon$/ }))?.props.color).toBe('yellow')
  await ui.unmount()
})

test('only a submitted plan turns the loader, and it stops once the plan settles', async ($, on) => {
  const clock = mock.clock(on, { now: Date.parse('2026-10-02T10:00:00.000Z') })
  sessionState(on)
  prepares(on, READY)
  let redraws = 0
  on('ui.invalidate', () => {
    redraws += 1
    return { value: undefined }
  })
  let view: unknown = { planId: READY.planId, status: 'submitted' }
  on('tool.call', { tool: 'mcp__otto__get_plan' }, () => ({ result: JSON.stringify(view) }))
  await $.tool.call({ tool: 'mcp__otto__prepare_trade' })
  await clock.advance(1_200)
  // Ready: the countdown's one redraw a second and no more.
  expect(redraws).toBe(1)
  await $.tool.call({ tool: 'mcp__otto__get_plan' })
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect((await ui.find({ key: 'ottopus-card' }))?.props.borderColor).toBe('yellow')
  expect(await ui.find({ type: 'Text', text: / · awaiting confirmation$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: / left/ })).toBeUndefined()
  const frames = new Set<string>()
  for (let i = 0; i < 8; i += 1) {
    await clock.advance(120)
    await ui.redraw()
    frames.add(String((await ui.find({ type: 'Text', text: /^[⠲⠶⠾⠻⠹⠽⠵⠷]$/ }))?.children))
  }
  expect(frames.size).toBe(8)
  expect(redraws).toBe(9)
  view = { planId: READY.planId, status: 'confirmed' }
  await $.tool.call({ tool: 'mcp__otto__get_plan' })
  await ui.redraw()
  expect((await ui.find({ key: 'ottopus-card' }))?.props.borderColor).toBe('green')
  expect((await ui.find({ type: 'Text', text: '✓' }))?.props.color).toBe('green')
  expect(await ui.find({ type: 'Text', text: /^[⠲⠶⠾⠻⠹⠽⠵⠷]$/ })).toBeUndefined()
  // Seen turning confirmed, the plan gets one green sweep across the bar, and then the bar is gone.
  await clock.advance(BURST_MS / 2)
  await ui.redraw()
  const sweep = painted((await ui.find({ key: 'ottopus-meter' }))?.props.cells)
  expect(sweep.glyphs).toMatch(/^█+ *$/)
  await clock.advance(BURST_MS)
  await ui.redraw()
  expect(await ui.find({ key: 'ottopus-meter' })).toBeUndefined()
  const settled = redraws
  await clock.advance(10_000)
  expect(redraws).toBe(settled)
  await ui.unmount()
})

test('a refused plan and an expired one are both red, and neither moves', async ($, on) => {
  mock.clock(on, { now: Date.parse('2026-10-02T10:06:00.000Z') })
  sessionState(on)
  let result: unknown = READY
  on('tool.call', { tool: 'mcp__otto__prepare_trade' }, () => ({ result: JSON.stringify(result) }))
  await $.tool.call({ tool: 'mcp__otto__prepare_trade' })
  let ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  const expired = await ui.find({ key: 'ottopus-card' })
  expect(expired?.props.borderColor).toBe('red')
  expect((await ui.find({ type: 'Text', text: '✕' }))?.props.color).toBe('red')
  await ui.unmount()
  result = BLOCKED
  await $.tool.call({ tool: 'mcp__otto__prepare_trade' })
  ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect((await ui.find({ key: 'ottopus-card' }))?.props.borderColor).toBe('red')
  expect((await ui.find({ type: 'Text', text: '⊘' }))?.props.color).toBe('red')
  await ui.unmount()
})

/** The server's get_plan as the plugin's own call reaches it; records what was asked. */
function answers(on: On, answer: () => { isError?: boolean; structuredContent?: unknown }) {
  const asked: { server: string; tool: string; args: Record<string, unknown> }[] = []
  on('mcp.call', (_$, e) => {
    asked.push({ server: e.server, tool: e.tool, args: e.args })
    return { value: { content: [{ type: 'text', text: 'Status in words.' }], isError: false, ...answer() } }
  })
  return asked
}

test('the card follows a signature made in the browser by asking get_plan itself', async ($, on) => {
  const clock = mock.clock(on, { now: Date.parse('2026-10-02T10:00:00.000Z') })
  const state = sessionState(on)
  prepares(on, READY)
  let view: unknown = { planId: READY.planId, status: 'awaiting_review', expiresAt: READY.expiresAt }
  const asked = answers(on, () => ({ structuredContent: view }))
  await $.tool.call({ tool: 'mcp__otto__prepare_trade' })
  expect(asked).toHaveLength(0)
  await clock.advance(10_000)
  expect(asked).toEqual([
    { server: 'otto', tool: 'get_plan', args: { planId: READY.planId } },
    { server: 'otto', tool: 'get_plan', args: { planId: READY.planId } },
  ])
  expect(state.plan()?.status).toBe('awaiting_review')
  view = { planId: READY.planId, status: 'submitted', reviewUrl: 'https://evil.example/review/x' }
  await clock.advance(5_000)
  expect(state.plan()?.status).toBe('submitted')
  expect(state.plan()?.reviewUrl).toBe(READY.reviewUrl)
  // A submitted plan is watched past the quote's expiry, until the chain decides.
  await clock.advance(600_000)
  view = { planId: READY.planId, status: 'confirmed' }
  await clock.advance(5_000)
  expect(state.plan()?.status).toBe('confirmed')
  const settled = asked.length
  await clock.advance(120_000)
  expect(asked).toHaveLength(settled)
})

test('the watch asks once more as the quote runs out, then stops', async ($, on) => {
  const clock = mock.clock(on, { now: Date.parse('2026-10-02T10:04:50.000Z') })
  const state = sessionState(on)
  prepares(on, READY)
  const asked = answers(on, () => ({ structuredContent: { planId: READY.planId, status: 'awaiting_review' } }))
  await $.tool.call({ tool: 'mcp__otto__prepare_trade' })
  await clock.advance(120_000)
  expect(asked).toHaveLength(2)
  expect(state.plan()?.status).toBe('awaiting_review')
})

test('failed checks back off, keep the last status and give up', async ($, on) => {
  const clock = mock.clock(on, { now: Date.parse('2026-10-02T10:00:00.000Z') })
  const state = sessionState(on)
  prepares(on, { ...READY, expiresAt: '2026-10-02T11:00:00.000Z' })
  const asked = answers(on, () => ({ isError: true }))
  await $.tool.call({ tool: 'mcp__otto__prepare_trade' })
  await clock.advance(14_000)
  // 5s, then 10s later: the second has not come due yet.
  expect(asked).toHaveLength(1)
  await clock.advance(1_800_000)
  expect(asked).toHaveLength(5)
  expect(state.plan()?.status).toBe('awaiting_review')
})

test('a newer plan ends the watch on the old one', async ($, on) => {
  const clock = mock.clock(on, { now: Date.parse('2026-10-02T10:00:00.000Z') })
  sessionState(on)
  let id = 'first'
  on('tool.call', { tool: 'mcp__otto__prepare_trade' }, () => ({ result: JSON.stringify({ ...READY, planId: id }) }))
  const asked = answers(on, () => ({ structuredContent: { planId: id, status: 'awaiting_review' } }))
  await $.tool.call({ tool: 'mcp__otto__prepare_trade' })
  id = 'second'
  await $.tool.call({ tool: 'mcp__otto__prepare_trade' })
  await clock.advance(5_000)
  expect(asked.map((a) => a.args.planId)).toEqual(['second'])
})

test('a short quote repaints its bar in place between the seconds, on the terminal alone', async ($, on) => {
  const clock = mock.clock(on, { now: Date.parse('2026-10-02T10:04:10.000Z') })
  sessionState(on)
  prepares(on, READY)
  const blits: { key: string; glyphs: string }[] = []
  on('ui.blit', (_$, e) => {
    if ('cells' in e) blits.push({ key: e.key, glyphs: painted(e.cells).glyphs })
    return { value: {} }
  })
  await $.tool.call({ tool: 'mcp__otto__prepare_trade' })
  // A desktop has no cell grid: its bar is text, and nothing is repainted there.
  const desktop = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(await desktop.find({ type: 'Text', text: '█'.repeat(20) })).toBeDefined()
  await clock.advance(2_000)
  await desktop.unmount()
  expect(blits).toHaveLength(0)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await clock.advance(900)
  await ui.unmount()
  // Fifty seconds over 160 steps: a repaint every 312ms, each a little shorter.
  expect(blits.map((b) => b.key)).toEqual(['ottopus-meter', 'ottopus-meter', 'ottopus-meter'])
  expect(blits[2]!.glyphs).toMatch(/^█{18}[▏▎▍▌▋▊▉] $/)
})

test('a plan found already confirmed gets no sweep', async ($, on) => {
  const clock = mock.clock(on, { now: Date.parse('2026-10-02T10:00:00.000Z') })
  sessionState(on)
  prepares(on, { ...READY, status: 'confirmed' })
  await $.tool.call({ tool: 'mcp__otto__prepare_trade' })
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await clock.advance(100)
  await ui.redraw()
  expect(await ui.find({ type: 'Text', text: /^Ottopus · Plan confirmed/ })).toBeDefined()
  expect(await ui.find({ key: 'ottopus-meter' })).toBeUndefined()
  await ui.unmount()
})
