import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { BUBBLE_LAYOUTS, BUBBLE_PATTERNS, MAX_BUBBLES } from './bubble-field'
import { MAX_SEA_LIFE, SEA_LIFE, SEA_SPECIES } from './sea-life'
import { DEPTH_LEVELS, DEPTH_TOKENS } from './depth'
import { SKELETON_LINES, SWEEP_STAGGER } from './skeleton'

const read = (name: string) =>
  readFileSync(new URL(`../../app/styles/${name}`, import.meta.url), 'utf8')

const WATER = read('water.css')
const SEA_LIFE_CSS = read('sea-life.css')
const MOTION = read('motion.css')
/** The loader family's keyframes are ambient too, and bound by the same gate. */
const LOADERS = read('loaders.css')

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

const ALL = [...rules(WATER), ...rules(SEA_LIFE_CSS), ...rules(MOTION), ...rules(LOADERS)]

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

describe('the dialog exit duration is not a guess', () => {
  const dialogCss = read('dialog.css')

  /**
   * SignInDialog waits EXIT_MS before handing over to Privy's modal, because
   * the dialog holds the top layer for its whole exit. If the CSS slows down
   * and the constant does not, Privy opens behind it again.
   */
  it('matches the transition it waits for', () => {
    const source = readFileSync(new URL('../ui/dialog.tsx', import.meta.url), 'utf8')
    const declared = Number(/EXIT_MS = (\d+)/.exec(source)?.[1])
    const token = Number(/--ot-dur-base:\s*(\d+)ms/.exec(read('tokens.css'))?.[1])

    expect(declared).toBe(token)
    expect(dialogCss).toContain('var(--ot-dur-base)')
  })

  /**
   * A caller that switches to a dialog "on a phone" reads SHEET_MEDIA, and the
   * sheet itself is dialog.css's media query. If they disagree there is a band
   * of widths where the switch happens and the overlay shows up instead.
   */
  it('exports the sheet breakpoint as the same query dialog.css uses', () => {
    const source = readFileSync(new URL('../ui/dialog.tsx', import.meta.url), 'utf8')
    const declared = /SHEET_MEDIA = '([^']+)'/.exec(source)?.[1]
    const sheet = /@media\s*\(([^)]*max-width[^)]*)\)\s*\{[^}]*\.ot-dialog\s*\{[^}]*margin: auto auto 0/.exec(dialogCss)?.[1]

    expect(declared).toBeDefined()
    expect(sheet).toBeDefined()
    expect(declared).toBe(`(${sheet})`)
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

describe('sea life', () => {
  it('never draws more than six, and the default set keeps to three', () => {
    expect(MAX_SEA_LIFE).toBe(6)
    expect(SEA_LIFE.length).toBe(3)
  })

  it('has a shape and a keyframe for every species it can draw', () => {
    const source = readFileSync(new URL('./sea-life.tsx', import.meta.url), 'utf8')
    for (const species of SEA_SPECIES) {
      expect(source, species).toContain(`${species}: {`)
      expect(SEA_LIFE_CSS, species).toContain(`.ot-sea-life--${species}`)
    }
  })

  /**
   * The `animation` shorthand resets animation-play-state to `running`, so a
   * shorthand in a per-species rule would silently cancel the stillness gate
   * the base class sets. Longhands only.
   */
  it('tunes each species with longhands, so the stillness gate survives', () => {
    const shorthand = /(^|[;\s])animation\s*:(?!\s*none)/
    for (const rule of rules(SEA_LIFE_CSS)) {
      expect(shorthand.test(rule.body), rule.selectors.join(', ')).toBe(false)
    }
  })

  it('draws no faces — the water layer is scenery, and Otto is the character', () => {
    const markup = readFileSync(new URL('./sea-life.tsx', import.meta.url), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '')
    expect(markup).not.toMatch(/eye|pupil|brow|mouth/i)
  })

  it('staggers them, so they never set off together', () => {
    const delays = SEA_LIFE.map((creature) => creature.delay)
    expect(new Set(delays).size).toBe(delays.length)
  })

  it('keeps every creature inside its container', () => {
    for (const creature of SEA_LIFE) {
      expect(creature.left, creature.species).toBeGreaterThanOrEqual(0)
      expect(creature.left, creature.species).toBeLessThanOrEqual(100)
      expect(creature.top, creature.species).toBeGreaterThanOrEqual(0)
      expect(creature.top, creature.species).toBeLessThanOrEqual(100)
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
