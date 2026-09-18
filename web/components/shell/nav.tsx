'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/cn'
import { SHELL_ROUTES, isActive } from './routes'

/**
 * The sidebar nav, at lg and up. Below that the nav is BottomNav, and this is
 * not rendered at all — the two share SHELL_ROUTES and isActive so they cannot
 * disagree about where you are.
 *
 * `aria-current="page"` rather than styling alone: the active item is carried
 * by a background tint and a weight change, and neither reaches a screen
 * reader. It also stays correct on nested routes — /settings/wallets keeps
 * Settings marked.
 */
export function ShellNav({ className }: { className?: string }) {
  const pathname = usePathname()

  return (
    <nav aria-label="Sections" className={cn('flex flex-col gap-[2px]', className)}>
      {SHELL_ROUTES.map(({ href, label }) => {
        const active = isActive(pathname, href)
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'flex items-center gap-[10px] rounded-[10px] px-3 py-[9px] text-[14px]',
              'whitespace-nowrap transition-colors duration-[var(--ot-dur-fast)]',
              active
                ? 'bg-[var(--ot-surface-2)] font-semibold text-[var(--ot-text)]'
                : 'font-medium text-[var(--ot-text-2)] hover:bg-[var(--ot-surface-2)] hover:text-[var(--ot-text)]',
            )}
          >
            {label}
          </Link>
        )
      })}
    </nav>
  )
}
