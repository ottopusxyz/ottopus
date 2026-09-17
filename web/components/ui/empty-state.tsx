import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'

export interface EmptyStateProps {
  title: string
  description?: string
  /** Otto drifting, once the mascot lands in #48. A 150px square slot. */
  illustration?: ReactNode
  action?: ReactNode
  className?: string
}

/**
 * An empty state is an invitation, not an apology. It names the space, explains
 * it in one line, and offers the verb that fills it.
 *
 * The description is capped at 30ch because a centred paragraph wider than that
 * stops being scannable.
 */
export function EmptyState({
  title,
  description,
  illustration,
  action,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center gap-3 rounded-[var(--ot-radius-md)] px-6 py-8 text-center',
        className,
      )}
    >
      {illustration ? (
        <div aria-hidden className="h-[150px] w-[150px]">
          {illustration}
        </div>
      ) : null}
      <p className="font-display text-[20px] font-bold">{title}</p>
      {description ? (
        <p className="max-w-[30ch] text-[14px] leading-[1.5] text-[var(--ot-text-2)]">
          {description}
        </p>
      ) : null}
      {action ? <div className="mt-1">{action}</div> : null}
    </div>
  )
}
