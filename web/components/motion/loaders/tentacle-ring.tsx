import { cn } from '@/lib/cn'

/**
 * Eight dots, one per arm. The design is explicit: never six, never twelve.
 * They sit on a circle, so the positions are computed rather than transcribed —
 * transcribed pixel offsets only hold at the size they were drawn for.
 */
const ARMS = 8

export interface TentacleRingProps {
  /** 16–40px is the design's range. Larger than that wants Otto instead. */
  size?: number
  /** Inherits currentColor so it can sit on a coloured button. */
  tone?: 'plan' | 'current'
  label?: string
  className?: string
}

/**
 * L1 · Tentacle ring — the default spinner.
 *
 * Buttons, table cells, icon slots: anywhere Otto himself would be too loud.
 * Geometry only, no mascot, because an inline wait does not block the screen.
 */
export function TentacleRing({
  size = 24,
  tone = 'plan',
  label,
  className,
}: TentacleRingProps) {
  const dot = Math.max(3, Math.round(size * 0.15))
  const radius = size / 2 - dot / 2

  return (
    <span
      role={label ? 'status' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className={cn('ot-ring relative inline-block shrink-0', className)}
      style={{ width: size, height: size }}
    >
      {Array.from({ length: ARMS }, (_, i) => {
        const angle = (i / ARMS) * 2 * Math.PI - Math.PI / 2
        return (
          <span
            key={i}
            className="ot-ring-dot absolute rounded-full"
            style={{
              width: dot,
              height: dot,
              left: size / 2 + radius * Math.cos(angle) - dot / 2,
              top: size / 2 + radius * Math.sin(angle) - dot / 2,
              background: tone === 'plan' ? 'var(--ot-plan)' : 'currentColor',
              animationDelay: `${i * 0.2}s`,
            }}
          />
        )
      })}
    </span>
  )
}
