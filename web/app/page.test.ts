import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * The landing copy is settled — issue #6 says so and gives it verbatim. It is
 * the one thing on this page that is not a judgement call, and it is exactly
 * the thing a later "small tidy" would rewrite. Reading the source rather than
 * rendering keeps this honest about what it checks: the words, not the layout.
 */
const SOURCE = readFileSync(new URL('./page.tsx', import.meta.url), 'utf8')

/** JSX wraps prose across lines; the words are what matter, not the wrapping. */
const FLAT = SOURCE.replace(/\s+/g, ' ')

const SETTLED = [
  'Stop juggling wallets to get one thing done',
  'Tell your agent what you want, not where to find it. Ottopus works out which wallet, which chain and which app — then shows you exactly what will happen before anything moves.',
  'Link your first wallet',
  'See what a review looks like',
  'Ottopus never holds a key and never asks for a seed phrase.',
  'One conversation instead of six tabs',
  'One intent. Every wallet. You still sign.',
  'Link your wallets',
  'Hardware, hot, or a Safe. Up to eight — Otto only has eight arms.',
  'Point your agent at Ottopus',
  'Works with Claude, Codex, or whatever you already talk to. Nothing to install.',
  'Say what you want',
]

describe('landing copy', () => {
  for (const line of SETTLED) {
    it(`keeps "${line.slice(0, 46)}${line.length > 46 ? '…' : ''}" verbatim`, () => {
      expect(FLAT).toContain(line)
    })
  }
})

describe('landing structure', () => {
  it('offers exactly one primary button', () => {
    const primaries = FLAT.match(/variant: 'primary'/g) ?? []
    expect(primaries).toHaveLength(1)
  })

  it('sends the second call to action to a review, not to sign-in', () => {
    expect(FLAT).toMatch(/href="\/review\//)
  })

  /**
   * Water lives in the page canvas, and on this page that is the hero alone.
   * Ambient markup below the fold would put motion behind copy.
   */
  it('keeps the ambient layer in the hero', () => {
    const hero = FLAT.slice(0, FLAT.indexOf('One conversation instead of six tabs'))
    const rest = FLAT.slice(FLAT.indexOf('One conversation instead of six tabs'))
    expect(hero).toContain('BubbleField')
    expect(hero).toContain('ot-caustic')
    expect(rest).not.toMatch(/BubbleField|ot-caustic|ot-canvas/)
  })
})
