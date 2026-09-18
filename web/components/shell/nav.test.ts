import { describe, expect, it } from 'vitest'
import { NAV_ICON_NAMES } from './nav-icon'
import { SHELL_ROUTES, isActive } from './routes'

/**
 * The sidebar and the bottom bar are one nav in two shapes. These are the two
 * things that would let them disagree: a route whose icon nothing draws, and a
 * second copy of "am I the current page".
 */
describe('the nav', () => {
  it('has a glyph for every route, so no tab is a hole in the bar', () => {
    for (const route of SHELL_ROUTES) {
      expect(NAV_ICON_NAMES, `${route.label} asks for the "${route.icon}" glyph`).toContain(
        route.icon,
      )
    }
  })

  it('draws no glyph nothing asks for', () => {
    const asked = new Set(SHELL_ROUTES.map((route) => route.icon))
    for (const name of NAV_ICON_NAMES) {
      expect([...asked], `nothing routes to the "${name}" glyph`).toContain(name)
    }
  })

  it('marks a route current on its own page', () => {
    expect(isActive('/settings', '/settings')).toBe(true)
  })

  it('keeps a route current on a nested page', () => {
    expect(isActive('/settings/wallets', '/settings')).toBe(true)
  })

  it('does not mark a route whose href is only a prefix of the path', () => {
    // /settings-old is not inside /settings, and a bare startsWith would say
    // it was. This is the reason isActive exists rather than being inlined.
    expect(isActive('/settings-old', '/settings')).toBe(false)
  })

  it('marks exactly one route on every page it has', () => {
    for (const route of SHELL_ROUTES) {
      const marked = SHELL_ROUTES.filter((other) => isActive(route.href, other.href))
      expect(marked.map((r) => r.href)).toEqual([route.href])
    }
  })
})
