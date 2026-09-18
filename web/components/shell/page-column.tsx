import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'

/**
 * The column a one-column page lives in: 720px of content plus the page
 * gutters on either side, centred in main.
 *
 * Header and body both go inside it, so the title, the hairline under it and
 * the cards share edges. Cards centred under a left-anchored title would give
 * one screen two left edges, which is the version this exists to prevent.
 *
 * Not for the portfolio, which is full-bleed with a right rail. It is for the
 * pages whose content is a stack of cards or a single empty state — those read
 * better as a column than as a strip hanging off the sidebar on a wide screen.
 */
export function PageColumn({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('mx-auto w-full max-w-[772px]', className)}>{children}</div>
}
