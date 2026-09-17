import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { POSES, POSE_NAMES, SWAY_DELAYS } from './otto-poses'

/**
 * Otto was transcribed once without his props — every pose drew the octopus and
 * dropped the coin, the cube, the receipt and the warning triangle. It looked
 * plausible, so nothing caught it until someone noticed the juggling loader had
 * nothing in the air.
 *
 * These assert the parts that are easy to lose in a transcription and hard to
 * see are missing.
 */

const SOURCE = readFileSync(new URL('./otto-poses.tsx', import.meta.url), 'utf8')

/** A pose is its geometry and its prop. These are the ones holding something. */
const MUST_HOLD_SOMETHING = [
  'planning',
  'loader',
  'plan-ready',
  'simulating',
  'tapping',
  'heads-up',
] as const

/** These draw something behind the arms rather than in front of them. */
const MUST_HAVE_A_BACKDROP = ['ink', 'confirmed', 'simulating', 'tapping'] as const

describe('every pose is complete', () => {
  it('has seven back arms and a front arm', () => {
    for (const name of POSE_NAMES) {
      expect(POSES[name].arms, name).toHaveLength(7)
      expect(POSES[name].frontArm, name).toMatch(/^M[\d.]/)
    }
  })

  it('gives Otto something to hold wherever the design does', () => {
    for (const name of MUST_HOLD_SOMETHING) {
      expect(POSES[name].prop, `${name} has no prop`).toBeTypeOf('function')
    }
  })

  it('draws the backdrops — the ink cloud, the arcs, the glow', () => {
    for (const name of MUST_HAVE_A_BACKDROP) {
      expect(POSES[name].behind, `${name} has no backdrop`).toBeTypeOf('function')
    }
  })

  it('has a face on every pose', () => {
    for (const name of POSE_NAMES) {
      expect(POSES[name].face.length, name).toBeGreaterThanOrEqual(2)
    }
  })

  /** Celebrating is the one pose with no eyes: its face is closed-happy curves. */
  it('gives pupils to every pose that has open eyes', () => {
    for (const name of POSE_NAMES) {
      if (name === 'confirmed') {
        expect(POSES[name].pupils).toBeUndefined()
      } else {
        expect(POSES[name].pupils, `${name} has no pupils`).toHaveLength(2)
      }
    }
  })
})

describe('the loader actually juggles', () => {
  it('animates both props on the loader pose', () => {
    const block = SOURCE.slice(SOURCE.indexOf('  loader: {'), SOURCE.indexOf("  'plan-ready'"))
    expect(block).toMatch(/coin\(animated\)/)
    expect(block).toMatch(/chain\(animated\)/)
  })

  it('has the juggle and catch keyframes wired to the ambient gate', () => {
    const css = readFileSync(new URL('../../app/styles/otto.css', import.meta.url), 'utf8')
    for (const name of ['otto-juggle-a', 'otto-juggle-b', 'otto-catch', 'otto-blink', 'otto-bob']) {
      expect(css, `${name} keyframes missing`).toContain(`@keyframes ${name}`)
      expect(css, `.${name} class missing`).toContain(`.${name} {`)
    }
    expect(css).toContain('--ot-ambient-play')
  })

  it('catches with the two raised arms', () => {
    expect(POSES.loader.catchArms).toEqual([5, 6])
  })
})

describe('the badge is alive', () => {
  const badge = readFileSync(new URL('./otto-badge.tsx', import.meta.url), 'utf8')
  const css = readFileSync(new URL('../../app/styles/otto.css', import.meta.url), 'utf8')

  it('takes an animate prop with the three modes the design defines', () => {
    expect(badge).toMatch(/BadgeAnimation = 'none' \| 'idle' \| 'loader'/)
  })

  it('blinks, glances and curls its band', () => {
    for (const name of ['badge-blink', 'badge-look', 'badge-curl', 'badge-pulse']) {
      expect(css, `${name} keyframes missing`).toContain(`@keyframes ${name}`)
      expect(badge, `${name} unused`).toContain(name.replace('badge-', ''))
    }
  })

  /** "Never animate a badge below 24px" — the movement turns to noise. */
  it('refuses to animate below 24px', () => {
    expect(badge).toContain('MIN_ANIMATED_SIZE = 24')
    expect(badge).toMatch(/size >= MIN_ANIMATED_SIZE/)
  })
})

describe('sway', () => {
  it('staggers arms unevenly, as the design draws them', () => {
    expect(SWAY_DELAYS).toHaveLength(7)
    // A uniform stagger would make eight arms move as one rippling row.
    const gaps = SWAY_DELAYS.slice(1).map((d, i) => +(d - SWAY_DELAYS[i]!).toFixed(2))
    expect(new Set(gaps).size).toBeGreaterThan(1)
  })
})
