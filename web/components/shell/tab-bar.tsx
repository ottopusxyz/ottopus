'use client'

import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import { Suspense, type ReactNode } from 'react'
import { cn } from '@/lib/cn'

export interface Tab {
  /** Value of the `tab` query parameter this selects. */
  value: string
  label: string
  /** Present but not yet built. Renders inert rather than linking nowhere. */
  disabled?: boolean
}

export interface TabBarProps {
  tabs: readonly Tab[]
  /** Used when the URL carries no `tab`. Defaults to the first tab. */
  fallback?: string
  /** Pushed to the right — the design puts a filter chip here. */
  aside?: ReactNode
  label: string
  className?: string
}

/**
 * The tab strip under a page header.
 *
 * Tabs are links carrying a `tab` query parameter, not local state: a person
 * should be able to reload the activity page, or send someone the approvals
 * view, and land where they were. That also means the active tab survives the
 * back button, which local state does not.
 *
 * The Suspense boundary lives here rather than in every page. Reading the query
 * string opts a route out of static prerendering, and the boundary is what
 * keeps the rest of the page static — so the component that causes the problem
 * is the one that solves it, and no caller has to remember.
 */
export function TabBar(props: TabBarProps) {
  const initial = props.fallback ?? props.tabs[0]?.value

  return (
    <Suspense fallback={<Bar {...props} current={initial} />}>
      <FromQuery {...props} />
    </Suspense>
  )
}

function FromQuery(props: TabBarProps) {
  const params = useSearchParams()
  const current = params.get('tab') ?? props.fallback ?? props.tabs[0]?.value
  return <Bar {...props} current={current} />
}

function Bar({
  tabs,
  aside,
  label,
  className,
  current,
}: TabBarProps & { current?: string }) {
  const pathname = usePathname()

  return (
    <div
      className={cn(
        'flex flex-wrap items-center justify-between gap-4',
        'border-b border-[var(--ot-border)] px-5 pt-4 sm:px-[26px]',
        className,
      )}
    >
      <nav aria-label={label} className="flex gap-5 overflow-x-auto">
        {tabs.map((tab) => {
          if (tab.disabled) {
            return (
              <span
                key={tab.value}
                aria-disabled
                className="pb-3 text-[14px] font-medium whitespace-nowrap text-[var(--ot-text-4)]"
              >
                {tab.label}
              </span>
            )
          }

          const active = tab.value === current
          return (
            <Link
              key={tab.value}
              href={`${pathname}?tab=${tab.value}`}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'border-b-2 pb-3 text-[14px] font-semibold whitespace-nowrap',
                'transition-colors duration-[var(--ot-dur-fast)]',
                active
                  ? 'border-[var(--ot-text)] text-[var(--ot-text)]'
                  : 'border-transparent text-[var(--ot-text-2)] hover:text-[var(--ot-text)]',
              )}
            >
              {tab.label}
            </Link>
          )
        })}
      </nav>
      {aside ? <div className="pb-[10px]">{aside}</div> : null}
    </div>
  )
}
