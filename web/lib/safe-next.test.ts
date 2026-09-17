import { describe, expect, it } from 'vitest'
import { DEFAULT_NEXT, safeNext } from './safe-next'

/**
 * The value arrives in a URL anyone can write and hand to someone else, and it
 * ends up in router.replace. Next navigates to a javascript: URL given one, so
 * this is script execution on our origin rather than merely an open redirect.
 */
describe('safeNext', () => {
  it('keeps a normal in-app path', () => {
    expect(safeNext('/portfolio')).toBe('/portfolio')
    expect(safeNext('/settings/wallets?tab=linked')).toBe('/settings/wallets?tab=linked')
  })

  it('falls back when there is nothing to use', () => {
    expect(safeNext(null)).toBe(DEFAULT_NEXT)
    expect(safeNext(undefined)).toBe(DEFAULT_NEXT)
    expect(safeNext('')).toBe(DEFAULT_NEXT)
  })

  it('refuses a javascript: URL', () => {
    for (const attack of [
      'javascript:alert(1)',
      'JavaScript:alert(1)',
      'java\tscript:alert(1)',
      'java\nscript:alert(1)',
      ' javascript:alert(1)',
    ]) {
      expect(safeNext(attack), attack).toBe(DEFAULT_NEXT)
    }
  })

  it('refuses other schemes', () => {
    for (const attack of ['data:text/html,<script>x</script>', 'https://evil.example', 'vbscript:x']) {
      expect(safeNext(attack), attack).toBe(DEFAULT_NEXT)
    }
  })

  /** Both spellings — several browsers normalise the backslash to a slash. */
  it('refuses protocol-relative destinations', () => {
    for (const attack of ['//evil.example', '/\\evil.example', '//evil.example/portfolio']) {
      expect(safeNext(attack), attack).toBe(DEFAULT_NEXT)
    }
  })

  it('refuses anything that is not rooted at a slash', () => {
    expect(safeNext('portfolio')).toBe(DEFAULT_NEXT)
    expect(safeNext('../admin')).toBe(DEFAULT_NEXT)
  })
})
