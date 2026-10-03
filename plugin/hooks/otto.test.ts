import { expect, test } from 'claude-code/testing'

import { isMoving, OTTO_COLUMNS, OTTO_ROWS, ottoCells, ottoPixels, ottoWave, poseOf } from './otto'
import { painted } from './painted'

test('each kind of card has its otto: blinking while it waits, smiling when confirmed, spent otherwise', () => {
  expect(poseOf('ready')).toBe('idle')
  expect(poseOf('submitted')).toBe('busy')
  expect(poseOf('confirmed')).toBe('happy')
  expect(['failed', 'refused', 'ended'].map((kind) => poseOf(kind as 'failed'))).toEqual(['spent', 'spent', 'spent'])
  expect((['idle', 'busy', 'happy', 'spent'] as const).filter(isMoving)).toEqual(['idle'])
})

const POSES = ['idle', 'busy', 'happy', 'spent'] as const

test('every frame is eight pixels by eight, a disc with clear corners and no outline', () => {
  for (const pose of POSES) {
    for (const now of [0, 200, 600, 4_000]) {
      const pixels = ottoPixels(pose, now)
      expect(pixels).toHaveLength(OTTO_ROWS * 2)
      expect(pixels.every((row) => row.length === OTTO_COLUMNS)).toBe(true)
      expect([pixels[0], pixels[7]].every((row) => /^\.\.[cm]{4}\.\.$/.test(row!))).toBe(true)
      expect([pixels[1], pixels[6]].every((row) => /^\.[cm]{6}\.$/.test(row!))).toBe(true)
      // Navy is the pupils and nothing else.
      expect(pixels.filter((row) => row.includes('n'))).toHaveLength(pose === 'spent' || now % 4_000 < 200 && pose === 'idle' ? 0 : 1)
    }
  }
})

test('the face is the badge: white eyes with navy pupils over a cream chin', () => {
  const pixels = ottoPixels('idle', 1_000)
  expect(pixels[3]).toBe('cwnccwnc')
  expect(pixels.slice(6)).toEqual(['.mmmmmm.', '..mmmm..'])
  expect(ottoPixels('busy', 1_000)[3]).toBe('cnwccnwc')
  expect(ottoPixels('spent', 1_000)[3]).toBe('cddccddc')
})

test('the cream meets the coral in a wave: two crests and two troughs, turned up at the corners for a smile', () => {
  const wave = ottoWave('idle')
  expect(wave).toHaveLength(OTTO_COLUMNS)
  expect([wave[1]! > wave[3]!, wave[5]! > wave[3]!, wave[5]! > wave[7]!]).toEqual([true, true, true])
  expect(ottoWave('spent')).toEqual(wave)
  const smile = ottoWave('happy')
  expect(Math.min(smile[0]!, smile[7]!) > Math.max(smile[3]!, smile[4]!)).toBe(true)
  // Drawn as lower eighths, cream on coral, in the row under his eyes.
  const { glyphs, colors } = painted(ottoCells('idle', 1_000))
  const row = glyphs.slice(OTTO_COLUMNS * 2, OTTO_COLUMNS * 3)
  expect(row).toBe('▃▄▁▀▂▄▁▁')
  expect(colors.slice(OTTO_COLUMNS * 2, OTTO_COLUMNS * 3).filter((color) => color === 0xfff0dc)).toHaveLength(7)
})

test('an idle otto blinks for 200ms every four seconds; every other pose is still', () => {
  expect(ottoCells('idle', 1_000)).toBe(ottoCells('idle', 1_600))
  expect(ottoCells('idle', 4_000)).not.toBe(ottoCells('idle', 4_200))
  expect(ottoCells('idle', 4_200)).toBe(ottoCells('idle', 1_000))
  for (const pose of ['busy', 'happy', 'spent'] as const) expect(ottoCells(pose, 0)).toBe(ottoCells(pose, 12_345))
})

test('cells are half blocks on the terminal’s own background, coral where he is', () => {
  const { glyphs, colors } = painted(ottoCells('idle', 1_000))
  expect(glyphs).toHaveLength(OTTO_COLUMNS * OTTO_ROWS)
  expect(glyphs).toMatch(/^[ ▀▁-█]+$/)
  // The top and bottom rows: clear at each corner, the curve of the disc between.
  expect(glyphs.slice(0, OTTO_COLUMNS)).toBe(' ▄▀▀▀▀▄ ')
  expect(glyphs.slice(-OTTO_COLUMNS)).toBe(' ▀▀▀▀▀▀ ')
  expect(colors).toContain(0xf58a6a)
})
