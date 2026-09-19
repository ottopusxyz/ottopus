/**
 * The app's route map, in one place because four things read it: the sidebar
 * nav, the bottom navbar, the route-shape test, and anything that needs to know
 * whether a path is inside the shell.
 */

/** Which glyph the bottom navbar draws. See nav-icon.tsx for the drawings. */
export type NavIconName = 'portfolio' | 'requests' | 'activity' | 'settings'

export interface ShellRoute {
  href: string
  label: string
  /**
   * Only the bottom bar uses it — the sidebar is text, as the design draws it.
   * It lives here anyway because a route without an icon is a bottom-bar item
   * with a hole in it, and this is the list a new route gets added to.
   */
  icon: NavIconName
}

/** Sidebar order, top to bottom; bottom-bar order, left to right. */
export const SHELL_ROUTES: readonly ShellRoute[] = [
  { href: '/portfolio', label: 'Portfolio', icon: 'portfolio' },
  { href: '/requests', label: 'Requests', icon: 'requests' },
  { href: '/activity', label: 'Activity', icon: 'activity' },
  { href: '/settings', label: 'Settings', icon: 'settings' },
]

/**
 * Whether a nav item is the page you are on.
 *
 * Shared by both navs rather than written twice: they are the same nav in two
 * shapes, and two copies of this is how one of them ends up highlighting
 * nothing on /settings/wallets while the other gets it right.
 */
export function isActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`)
}

/**
 * Routes that live outside the shell, each with the reason it is out.
 *
 * Adding to this list is the deliberate act: a page is inside the shell unless
 * someone writes down why it is not, and routes.test.ts fails if a route exists
 * outside the shell without an entry here.
 */
export const PUBLIC_ROUTES: Readonly<Record<string, string>> = {
  '/': 'Landing. A visitor here is not signed in, so there is nothing to navigate.',
  '/signin':
    'Sign-in. A signed-out visitor has no nav, and this is where shell routes send them.',
  '/styleguide': 'The design system, for us. App chrome around it would be confusing.',
  '/review':
    'A review link opens on a phone, from a chat, to decide one thing. The card is the page; nav around it would say this is a place to browse.',
  '/oauth':
    'OAuth consent. A redirect target an agent sent someone to, not a page they browsed to — ' +
    'app chrome would invite wandering off mid-decision, and this is a grant screen.',
}

export function isShellRoute(pathname: string): boolean {
  return SHELL_ROUTES.some((r) => isActive(pathname, r.href))
}
