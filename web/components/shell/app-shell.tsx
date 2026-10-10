'use client'

import type { ReactNode } from 'react'
import { OttoBadge } from '@/components/brand'
import { AccountMenu } from './account-menu'
import { AgentCard } from './agent-card'
import { BottomNav } from './bottom-nav'
import { ShellNav } from './nav'
import { SidebarNudge } from './first-intent-nudge'
import { NudgePlacementProvider, useSidebarNudge } from './nudge-placement'

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
 * The app frame: a 216px sidebar beside the page at lg, a bottom bar below it.
 *
 * Built once, here, because three screens assume a nav, a page header and a
 * container exist. Whoever built one first would have defined it for the rest
 * by accident.
 *
 * The sidebar is two blocks rather than one, placed into the same grid column,
 * so the brand and the nav can sit at the top while the account group is pinned
 * to the bottom without a spacer between them in the DOM.
 *
 * Below lg both blocks are gone and BottomNav is the whole nav. #68 replaced
 * the fallback that came before — a nav strip above the page and an account
 * strip below it, which sandwiched the balance between two bands of chrome.
 * The account group's contents did not move to the bar; they moved to Settings,
 * which is where a four-item bar cannot follow them.
 *
 * Still no drawer. A bottom bar needs no trigger, no focus trap and no escape
 * key, which is exactly why it is the right answer here.
 */
export function AppShell(props: AppShellProps) {
  return (
    <NudgePlacementProvider>
      <Shell {...props} />
    </NudgePlacementProvider>
  )
}

function Shell({ children, agent, account }: AppShellProps) {
  const sidebarNudge = useSidebarNudge()
  return (
    <div className="ot-app-shell flex min-h-dvh flex-col bg-[var(--ot-page)] p-0 sm:p-6">
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
          'ot-app-grid grid flex-1 overflow-hidden border-[var(--ot-border)] bg-[var(--ot-surface)] ' +
          'sm:rounded-[18px] sm:border ' +
          // Below lg main is the only item in the grid, and it gets all of it —
          // a page that pins its own height (the portfolio) needs a definite
          // row to pin to, and one that does not simply fills the card.
          'grid-rows-[minmax(0,1fr)] ' +
          'lg:grid-cols-[216px_minmax(0,1fr)] lg:grid-rows-[auto_minmax(0,1fr)_auto]'
        }
      >
        <aside
          aria-label="Sidebar"
          className={`${COLUMN} hidden flex-col gap-[22px] pt-5 pb-4 lg:row-start-1 lg:flex`}
        >
          <div className="flex items-center gap-[9px] px-2">
            <OttoBadge tier="icon" size={26} />
            <span className="font-display text-[18px] font-bold tracking-[-0.02em]">ottopus</span>
          </div>
          <ShellNav />
        </aside>

        {/* The scrolling region — see shell.css. ot-scroll for the same thin
            bar every other scroller in the app draws.

            `relative` is load-bearing, not layout: a scroll container has to be
            the containing block for what it scrolls. Without it, anything
            position:absolute inside — every .sr-only label, the theme
            control's hidden radios — resolves against the viewport instead,
            and its static position far down the page pads the *document's*
            scroll area while main clips it from view. The symptom was a second
            scrollbar at the window edge and an empty band under the frame,
            exactly as tall as the page's overflow. */}
        <main
          id="main"
          className="ot-scroll relative flex min-w-0 flex-col lg:col-start-2 lg:row-span-3 lg:row-start-1"
        >
          {children}
        </main>

        {/* Carries the column's surface through the gap the two blocks leave. */}
        <div aria-hidden className={`${COLUMN} hidden lg:row-start-2 lg:block`} />

        <aside
          aria-label="Account and agent"
          className={`${COLUMN} hidden flex-col gap-3 pt-4 pb-5 lg:row-start-3 lg:flex`}
        >
          {/* Otto offers on every route, unless the portfolio's rail is already asking. */}
          {sidebarNudge ? <SidebarNudge /> : null}
          {agent ?? <AgentCard />}
          {/* The theme control and sign-out live inside the menu. The shell is
              the only chrome the app has, and Settings carries a second copy
              of both for the widths where this column is not on screen. */}
          {account ?? <AccountMenu />}
        </aside>
      </div>

      {/* Last in the DOM on purpose: content before chrome, so a tab from the
          skip link reaches the page rather than the nav. It is painted at the
          bottom edge regardless — see shell.css. */}
      <BottomNav />
    </div>
  )
}
