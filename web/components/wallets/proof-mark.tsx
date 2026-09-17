import { cn } from '@/lib/cn'

export interface ProofMarkProps {
  /** Watch-only arms carry no proof and can never sign. */
  isWatchOnly: boolean
  /** 16px reads beside a 14px name; 18px suits the portfolio card. */
  size?: number
  className?: string
}

/**
 * Whether an arm proved itself, at a glance.
 *
 * This is the single most consequential fact about a wallet in Ottopus — it
 * decides whether a plan can be routed through it at all — so it gets a mark
 * beside the name rather than a chip further along the row that the eye reaches
 * second.
 *
 * Tinted background with matching text, never a solid fill: white fails AA on
 * the green, and the design system reserves `--ot-on-state` for the cases where
 * a solid one is genuinely wanted.
 *
 * The label is on the wrapper and the SVG is hidden, so assistive technology
 * reads one phrase instead of announcing a graphic it cannot describe.
 */
export function ProofMark({ isWatchOnly, size = 16, className }: ProofMarkProps) {
  const label = isWatchOnly
    ? 'Watch-only — ownership not proved, cannot sign'
    : 'Ownership proved — can sign'

  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      style={{ width: size, height: size }}
      className={cn(
        'inline-flex flex-none items-center justify-center rounded-full',
        isWatchOnly
          ? 'bg-[var(--ot-surface-3)] text-[var(--ot-text-3)]'
          : 'bg-[var(--ot-ok-bg)] text-[var(--ot-ok-text)]',
        className,
      )}
    >
      <svg
        aria-hidden
        viewBox="0 0 16 16"
        width={size * 0.72}
        height={size * 0.72}
        fill="none"
        stroke="currentColor"
        strokeWidth={2.2}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {isWatchOnly ? (
          // An eye: watched, not held. Deliberately not a crossed-out tick —
          // nothing failed here, and a failure mark would read as a warning.
          <>
            <path d="M1.6 8s2.4-4 6.4-4 6.4 4 6.4 4-2.4 4-6.4 4S1.6 8 1.6 8Z" />
            <circle cx="8" cy="8" r="1.6" />
          </>
        ) : (
          <path d="M3.2 8.4 6.4 11.4 12.8 4.8" />
        )}
      </svg>
    </span>
  )
}
