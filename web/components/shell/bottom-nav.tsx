'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/cn'
import { NavIcon } from './nav-icon'
import { SHELL_ROUTES, isActive } from './routes'

/**
 * The nav below lg: a bar on the bottom edge, icon over label.
 *
 * The same four routes as the sidebar, in the same order, marked the same way —
 * it is one nav in two shapes, which is why both read SHELL_ROUTES and both ask
 * `isActive`. What changes is only where it sits.
 *
 * It replaces the top strip rather than joining it. A phone that carried both
 * would sandwich the balance between two bands of chrome, which is the thing
 * this is here to undo.
 *
 * Fixed rather than in flow: the shell's height is content-driven on every page
 * but the portfolio, so a bar in flow would scroll away on a long settings page
 * — which is not a bottom bar. The space it covers is reserved by the shell's
 * padding, in shell.css, so no page has to remember.
 */
export function BottomNav() {
  const pathname = usePathname()

  return (
    <nav aria-label="Sections" className="ot-bottom-nav">
      <ul className="m-0 flex h-full list-none items-stretch p-0">
        {SHELL_ROUTES.map((route) => {
          const active = isActive(pathname, route.href)
          return (
            <li key={route.href} className="min-w-0 flex-1">
              <Link
                href={route.href}
                aria-current={active ? 'page' : undefined}
                // The whole tab is the target, not the icon: at four across a
                // 320px screen that is 80px wide and the bar's full 58px tall.
                className={cn(
                  'flex h-full flex-col items-center justify-center gap-[3px]',
                  'transition-colors duration-[var(--ot-dur-fast)]',
                  'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--ot-plan)]',
                  active
                    ? 'text-[var(--ot-text)]'
                    : 'text-[var(--ot-text-3)] active:text-[var(--ot-text)]',
                )}
              >
                {/* The tint is on a pill behind the icon rather than the whole
                    tab: a full-height block in a four-up bar reads as a
                    selected column, not a current page. */}
                <span
                  className={cn(
                    'flex items-center rounded-[var(--ot-radius-pill)] px-[15px] py-[3px]',
                    'transition-colors duration-[var(--ot-dur-fast)]',
                    active ? 'bg-[var(--ot-surface-3)]' : 'bg-transparent',
                  )}
                >
                  <NavIcon name={route.icon} className="h-[21px] w-[21px]" />
                </span>
                <span
                  className={cn(
                    'max-w-full truncate text-[11px] leading-none',
                    active ? 'font-semibold' : 'font-medium',
                  )}
                >
                  {route.label}
                </span>
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
