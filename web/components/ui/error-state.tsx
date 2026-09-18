import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'

export interface ErrorStateProps {
  title: string
  /**
   * What went wrong. The design's own example ends by saying what did *not*
   * happen — "nothing was signed and no request was built" — and on a product
   * that moves money that half is the point. A failure someone cannot bound is
   * a failure they have to assume the worst about.
   */
  description?: string
  /** Otto, inked. A 150px square slot, matching EmptyState. */
  illustration?: ReactNode
  /** Usually "Try again". Secondary, because it is a retry, not an invitation. */
  action?: ReactNode
  className?: string
}

/**
 * S4 in the design: "Loading is the only one that moves. Errors hold still and
 * say what did not happen."
 *
 * Sibling of EmptyState, and the difference between them is the whole idea. An
 * empty state is an invitation — it names a space and offers the verb that
 * fills it. An error state is a report: something was attempted, it did not
 * work, and here is the boundary of the damage.
 *
 * `data-stillness="held"` is not decoration. It freezes every ambient animation
 * inside, because the water layer means "nothing needs you" — so stopping it is
 * how the product raises its voice, and an error is exactly when it should.
 */
export function ErrorState({
  title,
  description,
  illustration,
  action,
  className,
}: ErrorStateProps) {
  return (
    <div
      data-stillness="held"
      role="alert"
      className={cn(
        'flex flex-col items-center gap-2.5 rounded-[var(--ot-radius-md)] px-5 py-[26px] text-center',
        className,
      )}
    >
      {illustration ? (
        <div aria-hidden className="h-[150px] w-[150px]">
          {illustration}
        </div>
      ) : null}
      <p className="font-display text-[18px] font-bold">{title}</p>
      {description ? (
        // 32ch rather than EmptyState's 30ch: an error has more to say, because
        // it has to name the boundary as well as the failure.
        <p className="max-w-[32ch] text-[13px] leading-[1.5] text-[var(--ot-text-2)]">
          {description}
        </p>
      ) : null}
      {action ? <div className="mt-1">{action}</div> : null}
    </div>
  )
}
