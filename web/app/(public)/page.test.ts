import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * The landing copy is settled: stocks lead, the wallet and dapp clutter is
 * what goes away, and you still sign. It is the one thing on this page that
 * is not a judgement call, and it is exactly the thing a later "small tidy"
 * would rewrite. Reading the source rather than rendering keeps this honest
 * about what it checks: the words, not the layout.
 */
const SOURCE = readFileSync(new URL('./page.tsx', import.meta.url), 'utf8')

/** JSX wraps prose across lines; the words are what matter, not the wrapping. */
const FLAT = SOURCE.replace(/\s+/g, ' ')

const SETTLED = [
  'Buy the stock, <span className="block text-[var(--ot-coral-text)]">not the token.</span>',
  'Ottopus finds the right stock token, the wallet that can pay and the route — no juggling wallets, no hunting for dapps — then shows you exactly what will happen before anything moves.',
  'Link your first wallet',
  'See what a review looks like',
  'Ottopus never holds a key, never signs and never broadcasts.',
  'One conversation instead of six tabs',
  'You sign, or your agent wallet sends',
  'What Otto checks before you ever see it',
  'One intent. Every wallet. You still sign.',
]

describe('landing copy', () => {
  for (const line of SETTLED) {
    it(`keeps "${line.slice(0, 46)}${line.length > 46 ? '…' : ''}" verbatim`, () => {
      expect(FLAT).toContain(line)
    })
  }
})

describe('landing structure', () => {
  /**
   * One primary action on the page. SignInCta is primary by default, so the
   * count is of it plus anything else asking for the coral fill.
   */
  it('offers exactly one primary action', () => {
    // The brand bar's Sign in is a LandingAccount, drawn ghost; only a bare
    // SignInCta takes the coral fill.
    const ctas = FLAT.match(/<SignInCta(?![^>]*variant=)/g) ?? []
    const explicitPrimaries = FLAT.match(/variant: 'primary'/g) ?? []
    expect(ctas.length + explicitPrimaries.length).toBe(1)
  })

  it('keeps the brand bar to the lockup, the repo and the account', () => {
    const bar = FLAT.slice(FLAT.indexOf('<header'), FLAT.indexOf('</header>'))
    expect(bar).toContain('REPO_URL')
    expect(bar).toContain('<LandingAccount')
    expect(bar).not.toContain('ThemeToggle')
    expect(FLAT).not.toContain('Transaction review for AI agents')
  })

  /** The one place the event is named, kept quiet and kept in the footer. */
  it('names where it was built once, in the footer', () => {
    const footer = FLAT.slice(FLAT.indexOf('<footer'), FLAT.indexOf('</footer>'))
    expect(footer).toContain('{BUILT_DURING}')
    expect(FLAT.match(/BNB Hack/g)).toHaveLength(1)
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
    expect(hero).toContain('SeaLife')
    expect(rest).not.toMatch(/BubbleField|ot-caustic|ot-canvas/)
  })
})
