'use client'

import Link from 'next/link'
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { ThemeToggle } from '@/components/theme-toggle'
import { cn } from '@/lib/cn'
import { NavIcon } from './nav-icon'

/** What the shell calls the signed-in person. */
export interface Identity {
  /** The best name we have: what they typed, what they picked, or what they connected. */
  label: string
  /** The next thing that identifies them, when it differs — an email under a name. */
  detail?: string
  /** The label is an address or a DID, which read better in the mono face. */
  mono?: boolean
}

export interface AccountMenuProps {
  /** Absent means nobody is signed in; the menu still opens for the theme and the links. */
  identity?: Identity | undefined
  /** Absent hides the sign-out row rather than rendering one that does nothing. */
  onSignOut?: (() => void) | undefined
}

export const REPO_URL = 'https://github.com/koshikraj/ottopus'
/** The same address the service publishes as `resource_documentation`. */
export const DOCS_URL = 'https://ottopus.xyz'

/** Between the trigger's top edge and the menu's bottom edge. */
const GAP = 8

/**
 * The bottom of the sidebar: one row that opens a menu above itself.
 *
 * It replaced a stack — the identity row, a sign-out button and the three-way
 * theme control, all in the open. 130px of the column for things nobody
 * touches twice a day, and no room to add a link. Now the row is the identity
 * and everything else is behind it.
 *
 * A native popover rather than a hand-rolled one. Light dismiss, Escape and
 * focus returning to the trigger are the browser's, and the top layer means
 * the menu is never clipped by the app grid's overflow — the one thing an
 * absolutely-positioned menu inside a 216px column could not promise on a
 * short viewport.
 *
 * A disclosure, not an ARIA menu. This is a list of links, and a list of links
 * wants Tab, not roving arrow keys; role="menu" would promise keyboard
 * behaviour it does not have. aria-expanded on the trigger is the contract.
 *
 * Positioned from the trigger's rectangle when it opens, because the popover
 * lives in the top layer and knows nothing about the sidebar. Fixed coordinates
 * go stale the moment the page moves, so a scroll or a resize closes it rather
 * than leaving it floating over the wrong thing.
 */
export function AccountMenu({ identity, onSignOut }: AccountMenuProps) {
  const id = useId()
  const trigger = useRef<HTMLButtonElement>(null)
  const menu = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)

  const place = useCallback(() => {
    const t = trigger.current
    const m = menu.current
    if (!t || !m) return
    const rect = t.getBoundingClientRect()
    m.style.left = `${rect.left}px`
    m.style.bottom = `${window.innerHeight - rect.top + GAP}px`
  }, [])

  const close = useCallback(() => menu.current?.hidePopover(), [])

  useEffect(() => {
    if (!open) return
    window.addEventListener('resize', close)
    // Capture, so a scrolling region inside the page counts as well as the
    // document — the portfolio pins the document and scrolls its table.
    window.addEventListener('scroll', close, true)
    return () => {
      window.removeEventListener('resize', close)
      window.removeEventListener('scroll', close, true)
    }
  }, [open, close])

  return (
    <>
      <button
        ref={trigger}
        type="button"
        popoverTarget={id}
        aria-expanded={open}
        aria-controls={id}
        className={cn(
          'flex w-full cursor-pointer items-center gap-[9px] rounded-[10px] p-2 text-left',
          'bg-[var(--ot-surface-2)] transition-colors duration-[var(--ot-dur-fast)] hover:bg-[var(--ot-surface-3)]',
          'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ot-plan)]',
        )}
      >
        <Avatar size={24} />
        <span
          className={cn(
            'min-w-0 flex-1 truncate text-[13px] font-semibold',
            identity?.mono && 'font-mono text-[12px] font-medium text-[var(--ot-text-2)]',
            !identity && 'font-medium text-[var(--ot-text-2)]',
          )}
        >
          {identity?.label ?? 'Not signed in'}
        </span>
        <Kebab />
      </button>

      <div
        ref={menu}
        id={id}
        popover="auto"
        onToggle={(event) => {
          const next = event.newState === 'open'
          // Before the first paint of the open state: the toggle event fires
          // synchronously inside the show, so there is no frame at (0, 0).
          if (next) place()
          setOpen(next)
        }}
        className="ot-account-menu"
      >
        <div className="flex items-center gap-3 bg-[var(--ot-surface-2)] px-3.5 py-3">
          <Avatar size={36} />
          <div className="flex min-w-0 flex-col gap-[2px]">
            <span
              className={cn(
                'truncate text-[14px] font-semibold',
                identity?.mono && 'font-mono text-[13px] font-medium',
                !identity && 'font-medium text-[var(--ot-text-2)]',
              )}
            >
              {identity?.label ?? 'Not signed in'}
            </span>
            {identity?.detail ? (
              <span className="truncate text-[12px] text-[var(--ot-text-3)]">{identity.detail}</span>
            ) : null}
          </div>
        </div>

        <Group>
          <Item href="/settings" icon={<NavIcon name="settings" className="h-4 w-4" />} onClick={close}>
            Settings
          </Item>
        </Group>

        <Group>
          <Item href={DOCS_URL} external icon={<Book />} onClick={close}>
            Documentation
          </Item>
          <Item href={REPO_URL} external icon={<GitHub />} onClick={close}>
            GitHub
          </Item>
        </Group>

        {/* The three-way control, not a two-way toggle. "System" is a real
            choice and the default, and a switch would opt everyone out of it
            the first time they touched it. */}
        <Group className="flex justify-center px-3.5 py-2.5">
          <ThemeToggle />
        </Group>

        {onSignOut ? (
          <Group>
            <button
              type="button"
              onClick={() => {
                close()
                onSignOut()
              }}
              className={cn(
                ROW,
                'w-full text-[var(--ot-block-text)] hover:bg-[var(--ot-block-bg)]',
              )}
            >
              <Power />
              Sign out
            </button>
          </Group>
        ) : null}
      </div>
    </>
  )
}

/** One row's box. Shared by links and the sign-out button so they line up. */
const ROW =
  'flex cursor-pointer items-center gap-2.5 px-3.5 py-2 text-[13px] font-medium transition-colors duration-[var(--ot-dur-fast)] ' +
  'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--ot-plan)]'

function Group({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('border-t border-[var(--ot-border)] py-1.5', className)}>{children}</div>
}

/**
 * Closes on click, because the shell survives navigation: a Link changes the
 * page under the menu and would otherwise leave it open over the new one.
 */
function Item({
  href,
  icon,
  external = false,
  onClick,
  children,
}: {
  href: string
  icon: ReactNode
  external?: boolean
  onClick: () => void
  children: ReactNode
}) {
  const className = cn(ROW, 'text-[var(--ot-text-2)] hover:bg-[var(--ot-surface-2)] hover:text-[var(--ot-text)]')
  const label = (
    <>
      <span aria-hidden className="flex w-4 flex-none justify-center text-[var(--ot-text-3)]">
        {icon}
      </span>
      {children}
    </>
  )
  return external ? (
    <a href={href} target="_blank" rel="noreferrer" onClick={onClick} className={className}>
      {label}
    </a>
  ) : (
    <Link href={href} onClick={onClick} className={className}>
      {label}
    </Link>
  )
}

/** The placeholder disc. There are no avatar images anywhere in the product yet. */
function Avatar({ size }: { size: number }) {
  return (
    <span
      aria-hidden
      style={{ width: size, height: size }}
      className="flex-none rounded-full bg-[var(--ot-plan)]"
    />
  )
}

/* Glyphs on the nav-icon grid: a 24 box, a 1.7 stroke, round caps. */

function Kebab() {
  return (
    <svg aria-hidden viewBox="0 0 24 24" className="h-4 w-4 flex-none text-[var(--ot-text-3)]" fill="currentColor">
      <circle cx="12" cy="5" r="1.7" />
      <circle cx="12" cy="12" r="1.7" />
      <circle cx="12" cy="19" r="1.7" />
    </svg>
  )
}

function Book() {
  return (
    <svg aria-hidden viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20" />
    </svg>
  )
}

/** The mark itself, because a stroke drawing of an octocat is not one. */
function GitHub() {
  return (
    <svg aria-hidden viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor">
      <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
    </svg>
  )
}

function Power() {
  return (
    <svg aria-hidden viewBox="0 0 24 24" className="h-4 w-4 flex-none" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3v9" />
      <path d="M6.6 6.6a7.5 7.5 0 1 0 10.8 0" />
    </svg>
  )
}
