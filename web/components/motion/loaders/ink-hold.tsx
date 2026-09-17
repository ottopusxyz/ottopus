'use client'

import { OttoBadge } from '@/components/brand'
import { cn } from '@/lib/cn'

export interface InkHoldProps {
  title: string
  /** Mono, because it is usually a count and an estimate. */
  detail?: string
  /**
   * The escape. The design says always offer one — a screen someone cannot
   * leave is a screen that gets reloaded.
   */
  onEscape?: () => void
  escapeLabel?: string
  className?: string
}

/**
 * L6 · Ink hold — for a wait you cannot cancel but can leave.
 *
 * Navy ground, and the only dark loader in the system: it signals that the
 * thing is settled elsewhere now, on a chain, out of the app's hands. Always
 * offer the way out — a screen someone cannot leave is a screen that has to be
 * reloaded.
 */
export function InkHold({
  title,
  detail,
  onEscape,
  escapeLabel = 'Run in background',
  className,
}: InkHoldProps) {
  return (
    <div
      role="status"
      className={cn(
        'relative flex flex-col items-center justify-center gap-[14px] overflow-hidden',
        'rounded-[14px] bg-[var(--ot-navy)] px-6 py-10 text-[var(--ot-cream)]',
        className,
      )}
    >
      {[0, 1.4].map((delay) => (
        <span
          key={delay}
          aria-hidden
          className="ot-ink-ripple absolute h-[74px] w-[74px] rounded-full"
          style={{
            background: 'rgba(255,240,220,.10)',
            top: 'calc(50% - 68px)',
            animationDelay: `${delay}s`,
          }}
        />
      ))}

      <div className="ot-ink-pulse relative">
        <OttoBadge mono monoColor="var(--ot-cream)" size={52} />
      </div>

      <div className="relative flex flex-col items-center gap-[6px] text-center">
        <p className="font-display m-0 text-[17px] font-bold">{title}</p>
        {detail ? (
          <p className="m-0 font-mono text-[12px] text-[rgba(255,240,220,.62)]">{detail}</p>
        ) : null}
      </div>

      {onEscape ? (
        // Styled here rather than passed in: this is the one dark surface in
        // the system, and every button variant we have assumes a light ground.
        <button
          type="button"
          onClick={onEscape}
          className={
            'relative rounded-[var(--ot-radius-pill)] border border-[rgba(255,240,220,0.3)] ' +
            'px-[15px] py-[7px] text-[13px] font-semibold text-[var(--ot-cream)] ' +
            'transition-colors duration-[var(--ot-dur-fast)] hover:bg-[rgba(255,240,220,0.08)]'
          }
        >
          {escapeLabel}
        </button>
      ) : null}
    </div>
  )
}
