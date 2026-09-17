import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { BUBBLE_LAYOUTS, BUBBLE_PATTERNS, MAX_BUBBLES } from './bubble-field'
import { DEPTH_LEVELS, DEPTH_TOKENS } from './depth'
import { SKELETON_LINES, SWEEP_STAGGER } from './skeleton'

const read = (name: string) =>
  readFileSync(new URL(`../../app/styles/${name}`, import.meta.url), 'utf8')

const WATER = read('water.css')
const MOTION = read('motion.css')

interface Rule {
  selectors: string[]
  body: string
  reducedMotion: boolean
}

/**
 * A brace-matching walk rather than a regex: @keyframes and @media nest, and a
 * flat regex would happily read a keyframe step as a rule.
 */
function rules(css: string, reducedMotion = false): Rule[] {
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '')
  const out: Rule[] = []
  let i = 0

  while (i < stripped.length) {
    const open = stripped.indexOf('{', i)
    if (open === -1) break

    const prelude = stripped.slice(i, open).trim()
    let depth = 1
    let j = open + 1
    while (j < stripped.length && depth > 0) {
      if (stripped[j] === '{') depth += 1
      else if (stripped[j] === '}') depth -= 1
      j += 1
    }
    const body = stripped.slice(open + 1, j - 1)

    if (prelude.startsWith('@keyframes')) {
      // Steps, not rules.
    } else if (prelude.startsWith('@media')) {
      out.push(...rules(body, reducedMotion || prelude.includes('prefers-reduced-motion')))
    } else if (prelude.startsWith('@')) {
      // @import and friends never reach here with a body, but be explicit.
    } else {
      out.push({
        selectors: prelude
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
        body,
        reducedMotion,
      })
    }
    i = j
  }
  return out
}

const ALL = [...rules(WATER), ...rules(MOTION)]

/** Declares a keyframe animation, as opposed to merely tuning one. */
const startsAnimation = (body: string) =>
  (/(^|[;\s])animation\s*:/.test(body) || /animation-name\s*:/.test(body)) &&
  !/animation\s*:\s*none/.test(body)

/** `.ot-bubble--shallow` inherits the gate from `.ot-bubble`. */
const base = (selector: string) => selector.split('--')[0]!

describe('every ambient animation is gated by stillness', () => {
  const gated = new Set<string>()
  for (const rule of ALL) {
    if (!rule.reducedMotion && /animation-play-state\s*:\s*var\(--ot-ambient-play\)/.test(rule.body)) {
      for (const s of rule.selectors) gated.add(s)
    }
  }

  it('has classes wired to --ot-ambient-play at all', () => {
    expect(gated.size).toBeGreaterThan(0)
  })

  /**
   * The invariant behind the whole ocean layer: stillness is how the product
   * raises its voice, so an animation that ignores --ot-ambient-play would keep
   * moving inside a region the app deliberately froze. Adding an animated class
   * without the gate should fail here rather than in front of a judge.
   */
  it('leaves no animated class outside the gate', () => {
    const ungated = ALL.filter((r) => !r.reducedMotion && startsAnimation(r.body))
      .flatMap((r) => r.selectors)
      .filter((s) => !gated.has(s) && !gated.has(base(s)))

    expect(ungated).toEqual([])
  })

  it('stops every animated class under prefers-reduced-motion', () => {
    const stopped = new Set<string>()
    for (const rule of ALL) {
      if (rule.reducedMotion && /animation\s*:\s*none/.test(rule.body)) {
        for (const s of rule.selectors) stopped.add(s)
      }
    }

    const running = ALL.filter((r) => !r.reducedMotion && startsAnimation(r.body))
      .flatMap((r) => r.selectors)
      .filter((s) => !stopped.has(s) && !stopped.has(base(s)))

    expect(running).toEqual([])
  })
})

describe('timing tokens stay inside the design bands', () => {
  const seconds = (token: string): number => {
    const match = new RegExp(`${token}:\\s*([\\d.]+)(m?s)`).exec(MOTION)
    expect(match, `${token} is not declared in motion.css`).toBeTruthy()
    const value = Number(match![1])
    return match![2] === 'ms' ? value / 1000 : value
  }

  // "idle loops 3.2–3.6s · loaders 1.2–1.6s · one-shots ≤ 900ms"
  it('keeps idle loops between 3.2s and 3.6s', () => {
    for (const token of ['--ot-dur-idle', '--ot-dur-drift']) {
      expect(seconds(token)).toBeGreaterThanOrEqual(3.2)
      expect(seconds(token)).toBeLessThanOrEqual(3.6)
    }
  })

  it('keeps loader beats between 1.2s and 1.6s', () => {
    expect(seconds('--ot-dur-loader')).toBeGreaterThanOrEqual(1.2)
    expect(seconds('--ot-dur-loader')).toBeLessThanOrEqual(1.6)
  })

  it('caps one-shots at 900ms', () => {
    expect(seconds('--ot-dur-oneshot')).toBeLessThanOrEqual(0.9)
  })

  it('sweeps slower than any loader, so a skeleton never reads as speed', () => {
    expect(seconds('--ot-dur-sweep')).toBeGreaterThan(seconds('--ot-dur-loader'))
  })
})

describe('bubbles', () => {
  it('never draws more than four', () => {
    expect(MAX_BUBBLES).toBe(4)
    for (const pattern of BUBBLE_PATTERNS) {
      expect(BUBBLE_LAYOUTS[pattern].length, pattern).toBeLessThanOrEqual(MAX_BUBBLES)
    }
  })

  it('has a layout for every pattern, and none empty', () => {
    for (const pattern of BUBBLE_PATTERNS) {
      expect(BUBBLE_LAYOUTS[pattern].length, pattern).toBeGreaterThan(0)
    }
  })

  it('staggers them, so they never rise as a row', () => {
    for (const pattern of BUBBLE_PATTERNS) {
      const delays = BUBBLE_LAYOUTS[pattern].map((b) => b.delay)
      expect(new Set(delays).size, pattern).toBe(delays.length)
    }
  })

  it('keeps every bubble inside its container horizontally', () => {
    for (const pattern of BUBBLE_PATTERNS) {
      for (const bubble of BUBBLE_LAYOUTS[pattern]) {
        expect(bubble.left, pattern).toBeGreaterThanOrEqual(0)
        expect(bubble.left, pattern).toBeLessThanOrEqual(100)
      }
    }
  })
})

describe('skeletons', () => {
  it('varies line widths, so a block does not read as a table', () => {
    expect(new Set(SKELETON_LINES).size).toBe(SKELETON_LINES.length)
  })

  it('staggers adjacent lines', () => {
    expect(SWEEP_STAGGER).toBeGreaterThan(0)
  })
})

describe('depth', () => {
  it('has a distinct token for every level', () => {
    const tokens = DEPTH_LEVELS.map((level) => DEPTH_TOKENS[level])
    expect(new Set(tokens).size).toBe(DEPTH_LEVELS.length)
  })

  it('does not animate — depth is the one part of the ocean layer allowed behind an amount', () => {
    const source = readFileSync(new URL('./depth.tsx', import.meta.url), 'utf8')
    expect(source).not.toMatch(/animation|ot-shimmer|ot-drift|ot-bubble/)
  })
})
