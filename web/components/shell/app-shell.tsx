import type { ReactNode } from 'react'
import { OttoBadge } from '@/components/brand'
import { ThemeToggle } from '@/components/theme-toggle'
import { AccountRow } from './account-row'
import { AgentCard } from './agent-card'
import { ShellNav } from './nav'

export interface AppShellProps {
  children: ReactNode
  /** Pinned above the account row. #14 fills this. */
  agent?: ReactNode
  /** The signed-in identity. #5 fills this. */
  account?: ReactNode
}

/** The sidebar's surface, shared by the two blocks that make up the column. */
const COLUMN = 'bg-[var(--ot-card)] border-[var(--ot-border)] px-[14px] lg:col-start-1 lg:border-r'

/**
 * The app frame: a 216px sidebar beside the page.
 *
 * Built once, here, because three screens assume a nav, a page header and a
 * container exist. Whoever built one first would have defined it for the rest
 * by accident.
 *
 * The sidebar is two blocks rather than one, placed into the same grid column.
 * That is what lets the order differ per layout without rendering anything
 * twice: on a phone the nav sits above the page and the account group below it,
 * so a balance is not pushed under 300px of chrome. The DOM order is the tab
 * order is the reading order, on both.
 *
 * No drawer. There is no mobile drawing in the design, and a drawer needs a
 * trigger, a focus trap and an escape key that nothing else in the app has yet.
 */
export function AppShell({ children, agent, account }: AppShellProps) {
  return (
    <div className="flex min-h-dvh flex-col bg-[var(--ot-page)] p-0 sm:p-6">
      <a
        href="#main"
        className={
          'sr-only rounded-[var(--ot-radius-sm)] bg-[var(--ot-card)] px-4 py-2 text-[14px] ' +
          'font-semibold focus:not-sr-only focus:absolute focus:top-3 focus:left-3 focus:z-50'
        }
      >
        Skip to content
      </a>

      <div
        className={
          'grid flex-1 overflow-hidden border-[var(--ot-border)] bg-[var(--ot-surface)] ' +
          'sm:rounded-[18px] sm:border ' +
          'lg:grid-cols-[216px_minmax(0,1fr)] lg:grid-rows-[auto_1fr_auto]'
        }
      >
        <aside
          aria-label="Sidebar"
          className={`${COLUMN} flex flex-col gap-4 border-b py-4 lg:row-start-1 lg:gap-[22px] lg:border-b-0 lg:pt-5`}
        >
          <div className="flex items-center gap-[9px] px-2">
            <OttoBadge tier="icon" size={26} />
            <span className="font-display text-[18px] font-bold tracking-[-0.02em]">ottopus</span>
          </div>
          <ShellNav />
        </aside>

        <main id="main" className="flex min-w-0 flex-col lg:col-start-2 lg:row-span-3 lg:row-start-1">
          {children}
        </main>

        {/* Carries the column's surface through the gap the two blocks leave. */}
        <div aria-hidden className={`${COLUMN} hidden lg:row-start-2 lg:block`} />

        <aside
          aria-label="Account and agent"
          className={`${COLUMN} flex flex-col gap-3 border-t py-4 lg:row-start-3 lg:border-t-0 lg:pb-5`}
        >
          {agent ?? <AgentCard />}
          {account ?? <AccountRow />}
          {/* The shell is the only chrome the app has; there is no top bar to
              put the theme control in. */}
          <ThemeToggle className="justify-center" />
        </aside>
      </div>
    </div>
  )
}
