import { cn } from '@/lib/cn'
import { Skeleton } from '../skeleton'

/** The design's row stagger. */
const STAGGER = 0.15

/** "rows 4+ static at .6 opacity" — the eye only tracks the first few. */
const ANIMATED_ROWS = 3

export interface SkeletonShelfProps {
  rows?: number
  /** Matches the real row's leading element. 30px is the design's. */
  avatar?: number
  label?: string
  className?: string
}

/**
 * L5 · Skeleton shelf — the structure the user is about to see.
 *
 * Not a grey rectangle: the geometry has to match the real row within 2px, or
 * the page jumps at the moment someone starts reading it. Never mixed with a
 * spinner in the same region — one region, one answer to "what is happening".
 */
export function SkeletonShelf({
  rows = 4,
  avatar = 30,
  label = 'Loading',
  className,
}: SkeletonShelfProps) {
  return (
    <div
      role="status"
      aria-busy
      className={cn(
        'flex flex-col gap-[2px] overflow-hidden rounded-[12px] border border-[var(--ot-border)]',
        className,
      )}
    >
      <span className="sr-only">{label}</span>
      {Array.from({ length: rows }, (_, i) => {
        const live = i < ANIMATED_ROWS
        return (
          <div
            key={i}
            className={cn(
              'flex items-center gap-3 px-[15px] py-[13px]',
              i % 2 ? 'bg-[var(--ot-water-1)]' : 'bg-[var(--ot-card)]',
            )}
            style={live ? undefined : { opacity: 0.6 }}
          >
            <Skeleton
              width={avatar}
              height={avatar}
              radius={avatar / 2}
              sweep={live}
              delay={i * STAGGER}
            />
            <div className="flex flex-1 flex-col gap-[6px]">
              <Skeleton width="44%" height={9} radius={5} sweep={live} delay={i * STAGGER + 0.1} />
              <Skeleton width="26%" height={8} radius={5} sweep={false} />
            </div>
            <Skeleton width={56} height={9} radius={5} sweep={live} delay={i * STAGGER + 0.2} />
          </div>
        )
      })}
    </div>
  )
}
