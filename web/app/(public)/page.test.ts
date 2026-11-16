import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * The landing copy is settled: one intent, any asset, the wallet and dapp
 * clutter is what goes away, and you still sign. It is the one thing on this page that
 * is not a judgement call, and it is exactly the thing a later "small tidy"
 * would rewrite. Reading the source rather than rendering keeps this honest
 * about what it checks: the words, not the layout.
 */
const SOURCE = readFileSync(new URL('./page.tsx', import.meta.url), 'utf8')

/** JSX wraps prose across lines; the words are what matter, not the wrapping. */
const FLAT = SOURCE.replace(/\s+/g, ' ')

const SETTLED = [
  'Stop juggling wallets to <span className="text-[var(--ot-coral-text)]">get one thing done.</span>',
  'Let Otto juggle the wallets. You just sign.',
  'Tell your agent what you want: send, swap, bridge or buy. Otto finds the token, the wallet and the route on any chain, and checks it all before you sign.',
  'Link your first wallet',
  'Nothing moves until you sign.',
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

  it('keeps the brand bar to the lockup, how it works, the repo and the account', () => {
    const bar = FLAT.slice(FLAT.indexOf('<header'), FLAT.indexOf('</header>'))
    expect(bar).toContain('href="#how"')
    expect(bar).toContain('REPO_URL')
    expect(bar).toContain('<LandingAccount')
    expect(bar).not.toContain('ThemeToggle')
    expect(FLAT).not.toContain('Transaction review for AI agents')
  })

  /**
   * Ottopus is not one chain's or one asset's product. The worked example in
   * the hero and the story may be a stock on BNB Chain; the page's own words
   * must not be, and the event it was built at is not named on it.
   */
  it('keeps the copy neutral: no event, no single chain or asset class', () => {
    expect(FLAT).not.toMatch(/BNB Hack|Hackathon|Tokenized Stocks Edition|BUILT_AT/i)
    expect(FLAT).not.toMatch(/stock desk|own stocks|on BNB Chain/i)
  })

  /** The second action is adding Ottopus to an agent, the way Settings does. */
  it('offers adding Ottopus to an agent beside the first wallet', () => {
    expect(FLAT).toContain('<SignInCta>Link your first wallet</SignInCta> <AddToAgent />')
    expect(FLAT).not.toMatch(/href="\/review\//)
  })

  /**
   * The agent panel drops down from the hero and is taller than the room
   * under the button on a short screen. The sea clips itself; the hero must
   * not, or a client with steps loses its note past the section's edge.
   */
  it('lets the agent panel drop past the hero', () => {
    const hero = FLAT.slice(FLAT.indexOf('<section className="ot-land-sea'), FLAT.indexOf('<AddToAgent />'))
    const [section, ambient] = hero.split('<div aria-hidden')
    expect(section).not.toContain('overflow-hidden')
    expect(ambient).toContain('absolute inset-0 overflow-hidden')
  })

  /**
   * Water lives in the page canvas, and on this page that is the hero alone.
   * Ambient markup below the fold would put motion behind copy.
   */
  it('keeps the ambient layer in the hero', () => {
    const hero = FLAT.slice(0, FLAT.indexOf('<Story />'))
    const rest = FLAT.slice(FLAT.indexOf('<Story />'))
    expect(hero).toContain('BubbleField')
    expect(hero).toContain('ot-caustic')
    expect(hero).toContain('SeaLife')
    expect(rest).not.toMatch(/BubbleField|ot-caustic|ot-canvas/)
  })
})
