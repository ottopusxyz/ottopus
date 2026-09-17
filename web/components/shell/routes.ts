/**
 * The app's route map, in one place because three things read it: the sidebar
 * nav, the route-shape test, and anything that needs to know whether a path is
 * inside the shell.
 */

export interface ShellRoute {
  href: string
  label: string
}

/** Sidebar order, top to bottom. */
export const SHELL_ROUTES: readonly ShellRoute[] = [
  { href: '/portfolio', label: 'Portfolio' },
  { href: '/requests', label: 'Requests' },
  { href: '/activity', label: 'Activity' },
  { href: '/settings', label: 'Settings' },
]

/**
 * Routes that live outside the shell, each with the reason it is out.
 *
 * Adding to this list is the deliberate act: a page is inside the shell unless
 * someone writes down why it is not, and routes.test.ts fails if a route exists
 * outside the shell without an entry here.
 */
export const PUBLIC_ROUTES: Readonly<Record<string, string>> = {
  '/': 'Landing. A visitor here is not signed in, so there is nothing to navigate.',
  '/styleguide': 'The design system, for us. App chrome around it would be confusing.',
}

export function isShellRoute(pathname: string): boolean {
  return SHELL_ROUTES.some((r) => pathname === r.href || pathname.startsWith(`${r.href}/`))
}
