'use client'

import { usePrivy } from '@privy-io/react-auth'
import type { ReactNode } from 'react'
import { ThemeToggle } from '@/components/theme-toggle'
import { Button } from '@/components/ui'
import { cn } from '@/lib/cn'
import { usePrivyAvailable } from './privy-provider'
import { useIdentity } from './session-account-menu'

/**
 * Settings' account card.
 *
 * Sign-out has always lived at the foot of the sidebar, and #68 took the
 * sidebar off a phone. It has a second home here rather than a moved one: on a
 * wide screen the column is still where you reach for it, and a page that only
 * carries an action at some widths is a page that has lost it at the others.
 *
 * Settings is the better home in its own right, too. The sidebar button was a
 * word with no consequence attached; here there is room to say what signing out
 * does and, more usefully, what it does not.
 *
 * The theme control is here for the same reason. The sidebar's agent card is
 * not — this page already carries AgentsPanel, which is that card with the
 * grants, the scopes and the revoke behind it.
 */
export function SessionAccountPanel() {
  return usePrivyAvailable() ? <LivePanel /> : <Panel />
}

/** The P6 frame, matching the wallets and agents cards it sits beside. */
function Panel({ children }: { children?: ReactNode }) {
  return (
    <section className="overflow-hidden rounded-[18px] border border-[var(--ot-border)] bg-[var(--ot-card)]">
      <div className="flex items-center justify-between gap-4 border-b border-[var(--ot-border)] px-[22px] py-4">
        <h2 className="text-[15px] font-semibold">Account</h2>
      </div>
      {children}

      <Row label="Appearance" detail="Follows your system setting unless you pick one.">
        <ThemeToggle />
      </Row>
    </section>
  )
}

/**
 * A labelled setting. Wraps rather than truncates: at 320px the theme control
 * and its label do not fit on one line, and a wrapped row is better than a
 * clipped word.
 */
function Row({
  label,
  detail,
  children,
}: {
  label: string
  detail?: string
  children: ReactNode
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 border-t border-[var(--ot-border)] px-[22px] py-4 first:border-t-0">
      <div className="flex min-w-0 flex-col gap-[3px]">
        <span className="text-[14px] font-semibold">{label}</span>
        {detail ? (
          <span className="text-[12.5px] leading-[1.45] text-[var(--ot-text-2)]">{detail}</span>
        ) : null}
      </div>
      {children}
    </div>
  )
}

function LivePanel() {
  const { logout } = usePrivy()
  const identity = useIdentity()

  return (
    <Panel>
      <div className="flex flex-col gap-3 px-[22px] py-4">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <span aria-hidden className="h-8 w-8 flex-none rounded-full bg-[var(--ot-plan)]" />
            <div className="flex min-w-0 flex-col gap-[2px]">
              <span className="text-[12px] text-[var(--ot-text-3)]">Signed in as</span>
              {/* Breakable: this may be an address, and an address that
                  overflows its card is one you cannot check. */}
              <span
                className={cn(
                  'text-[13px] font-semibold break-all',
                  identity?.mono && 'font-mono font-medium',
                )}
              >
                {identity?.label ?? 'Not signed in'}
              </span>
              {identity?.detail ? (
                <span className="text-[12px] break-all text-[var(--ot-text-2)]">{identity.detail}</span>
              ) : null}
            </div>
          </div>
          {identity ? (
            <Button variant="secondary" size="sm" onClick={() => logout()}>
              Sign out
            </Button>
          ) : null}
        </div>

        {/* Beside the button rather than in a footer bar: what signing out does
            not do is the half worth reading, and it is no use two rows away. */}
        {identity ? (
          <p className="m-0 text-[12.5px] leading-[1.5] text-[var(--ot-text-2)]">
            Signing out ends this browser session and nothing else. Your wallets stay linked, every
            agent keeps the grant you gave it, and no key was ever here to take.
          </p>
        ) : null}
      </div>
    </Panel>
  )
}
