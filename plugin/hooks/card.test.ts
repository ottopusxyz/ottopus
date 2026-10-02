import { expect, test } from 'claude-code/testing'

import type { CapturedPlan } from '../types'
import { BURST_MS, burstCells, cardOf, clockTime, isUrgent, lifeLeft, meter, METER_CELLS, meterCells, PAINT, RGB, shareLeft, SPIN, spinFrame, timeLeft } from './card'
import { painted } from './painted'

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
    kind: 'ready',
    title: 'Plan ready',
    summary: READY.summary,
    lines: ['Main holds enough USDT and BNB for gas · PancakeSwap via LI.FI · ~$0.12 fees'],
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

test('each status wears its own kind, and each kind its own mark', () => {
  const kindOf = (status: string, now = BEFORE) => cardOf({ ...READY, status }, now)?.kind
  expect(kindOf('awaiting_review')).toBe('ready')
  expect(kindOf('awaiting_signature')).toBe('ready')
  expect(kindOf('submitted')).toBe('submitted')
  expect(kindOf('confirmed')).toBe('confirmed')
  expect(kindOf('failed')).toBe('failed')
  expect(kindOf('blocked')).toBe('refused')
  expect(kindOf('cancelled')).toBe('failed')
  expect(kindOf('superseded')).toBe('ended')
  expect(kindOf('awaiting_review', AFTER)).toBe('failed')
  expect(PAINT.failed.glyph).toBe('✕')
  expect(PAINT.ready).toEqual({ color: 'blue', glyph: '●' })
  expect(PAINT.confirmed).toEqual({ color: 'green', glyph: '✓' })
  expect(PAINT.failed.color).toBe('red')
  expect(PAINT.refused.color).toBe('red')
  expect(PAINT.ended.color).toBe(null)
  // No two kinds share a mark: the status reads without colour.
  expect(new Set(Object.values(PAINT).map((p) => p.glyph)).size).toBe(6)
})

test('the share of a quote left runs from the moment the plan was seen to its expiry', () => {
  expect(shareLeft(BEFORE, READY.expiresAt!, BEFORE)).toBe(100)
  expect(shareLeft(BEFORE, READY.expiresAt!, BEFORE + 150_000)).toBe(50)
  expect(shareLeft(BEFORE, READY.expiresAt!, AFTER - 1)).toBe(1)
  expect(shareLeft(BEFORE, READY.expiresAt!, AFTER)).toBe(null)
  expect(shareLeft(undefined, READY.expiresAt!, BEFORE)).toBe(null)
  expect(shareLeft(AFTER, READY.expiresAt!, BEFORE)).toBe(null)
  expect(shareLeft(BEFORE, 'soon', BEFORE)).toBe(null)
})

test('the meter drains with the share and never shows an empty bar while the quote holds', () => {
  expect(meter(100)).toEqual({ full: '█'.repeat(METER_CELLS), rest: '' })
  expect(meter(50)).toEqual({ full: '█'.repeat(10), rest: '░'.repeat(10) })
  expect(meter(30)).toEqual({ full: '█'.repeat(6), rest: '░'.repeat(14) })
  expect(meter(1)).toEqual({ full: '█', rest: '░'.repeat(METER_CELLS - 1) })
})

test('the clock asks to be noticed only in the last half minute', () => {
  expect(isUrgent(READY.expiresAt!, AFTER - 31_000)).toBe(false)
  expect(isUrgent(READY.expiresAt!, AFTER - 30_000)).toBe(true)
  expect(isUrgent(READY.expiresAt!, AFTER - 1)).toBe(true)
  expect(isUrgent(READY.expiresAt!, AFTER)).toBe(false)
  expect(isUrgent('soon', BEFORE)).toBe(false)
})

test('the loader steps a frame every 120ms and comes back round', () => {
  expect(spinFrame(0)).toBe(SPIN[0])
  expect(spinFrame(119)).toBe(SPIN[0])
  expect(spinFrame(120)).toBe(SPIN[1])
  expect(spinFrame(120 * SPIN.length)).toBe(SPIN[0])
})

test('the painted bar drains an eighth of a cell at a time and never reads empty', () => {
  expect(lifeLeft(BEFORE, READY.expiresAt!, BEFORE)).toBe(1)
  expect(lifeLeft(undefined, READY.expiresAt!, BEFORE)).toBe(null)
  expect(lifeLeft(BEFORE, READY.expiresAt!, AFTER)).toBe(null)
  expect(painted(meterCells(1, 300_000)).glyphs).toBe('█'.repeat(METER_CELLS))
  // Half a cell short of ten.
  expect(painted(meterCells(0.475, 300_000)).glyphs).toBe('█'.repeat(9) + '▌' + ' '.repeat(10))
  expect(painted(meterCells(0.0001, 300_000)).glyphs).toBe('▏' + ' '.repeat(19))
})

test('the painted bar is blue with time to spare and amber through the last half minute', () => {
  expect(new Set(painted(meterCells(0.5, 60_000)).colors)).toEqual(new Set([RGB.plan]))
  expect(new Set(painted(meterCells(0.5, 30_000)).colors)).toEqual(new Set([RGB.warn]))
  expect(new Set(painted(meterCells(0.5, 5_000)).colors)).toEqual(new Set([RGB.warn]))
  const [between] = painted(meterCells(0.5, 45_000)).colors
  expect(between).not.toBe(RGB.plan)
  expect(between).not.toBe(RGB.warn)
})

test('the confirmed sweep fills the bar from the left, holds it green, and ends', () => {
  const start = painted(burstCells(0)!)
  expect(start.glyphs).toBe('█' + ' '.repeat(19))
  const midway = painted(burstCells(300)!)
  expect(midway.glyphs).toMatch(/^█{5,19} +$/)
  // Behind the bright head the bar has already settled to green.
  expect(midway.colors[0]).toBe(RGB.ok)
  const held = painted(burstCells(BURST_MS - 1)!)
  expect(held.glyphs).toBe('█'.repeat(METER_CELLS))
  expect(new Set(held.colors)).toEqual(new Set([RGB.ok]))
  expect(burstCells(BURST_MS)).toBe(null)
})
