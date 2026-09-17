import { cn } from '@/lib/cn'

export interface TideBarProps {
  /**
   * Omit for indeterminate. Give it a fraction and the bar becomes
   * determinate — which the design wants "whenever a step count exists, and an
   * on-chain send always has one".
   */
  value?: number
  /** 3px at the top of a viewport, 8px inline in a card. */
  height?: number
  label?: string
  className?: string
}

/**
 * L2 · Tide bar.
 *
 * Indeterminate is for route changes and first paint only. Anything that can
 * be counted should be counted: fake progress that stalls at 90% is on the
 * design's "never" list, and an honest bar is the alternative.
 */
export function TideBar({ value, height = 3, label, className }: TideBarProps) {
  const determinate = typeof value === 'number'
  const pct = determinate ? Math.min(100, Math.max(0, value * 100)) : 0

  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuenow={determinate ? Math.round(pct) : undefined}
      aria-valuemin={determinate ? 0 : undefined}
      aria-valuemax={determinate ? 100 : undefined}
      className={cn(
        'relative w-full overflow-hidden bg-[var(--ot-water-2)]',
        height > 4 && 'rounded-[999px]',
        className,
      )}
      style={{ height }}
    >
      {determinate ? (
        <span
          className="absolute inset-y-0 left-0 rounded-[999px] bg-[var(--ot-plan)]"
          style={{
            width: `${pct}%`,
            transition: 'width var(--ot-dur-slow) var(--ot-ease-out)',
          }}
        />
      ) : (
        <span
          aria-hidden
          className="ot-tide absolute inset-y-0 left-0 w-[32%]"
          style={{
            background:
              'linear-gradient(90deg, transparent, var(--ot-plan), transparent)',
          }}
        />
      )}
    </div>
  )
}
