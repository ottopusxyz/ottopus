import { Otto, OttoBadge } from '@/components/brand'
import { cn } from '@/lib/cn'
import { BubbleField } from './bubble-field'

/**
 * The poses a loader may use. Otto is never a progress bar: he is doing
 * something, and which thing is the only choice here.
 */
export type LoaderPose = 'planning' | 'simulating'

/** The design's Otto, and the box the bubbles are drawn against. */
const OTTO_SIZE = 104
const BOX_W = 120
const BOX_H = 130

export interface OttoLoaderProps {
  /**
   * What is being waited on, in Otto's voice — "Otto is planning…". Required,
   * and not decoration: under reduced motion, and inside a held region, this
   * line is the entire loader.
   */
  label: string
  pose?: LoaderPose
  className?: string
}

/**
 * The full loader: Otto drifting, breathing bubbles, one line of text.
 *
 * For waits longer than about ten seconds. Anything shorter should use
 * InlineLoader — a mascot that appears and vanishes inside a second is noise.
 *
 * Deliberately fixed-size. The bubble positions are drawn against Otto's dome
 * at this exact scale, so a `size` prop could only be used wrongly.
 */
export function OttoLoader({ label, pose = 'planning', className }: OttoLoaderProps) {
  return (
    <div role="status" className={cn('flex flex-col items-center gap-3', className)}>
      <div
        className="relative flex items-end justify-center"
        style={{ width: `${BOX_W}px`, height: `${BOX_H}px` }}
      >
        <BubbleField pattern="breath" clip={false} />
        <div className="ot-drift">
          <Otto pose={pose} size={OTTO_SIZE} animated />
        </div>
      </div>
      <span className="text-[14px] font-semibold text-[var(--ot-text-2)]">{label}</span>
    </div>
  )
}

export interface InlineLoaderProps {
  label: string
  className?: string
}

/**
 * A pill of mid water with bubbles crossing it. For waits under ten seconds,
 * and for anywhere a loader has to sit in a row of content.
 */
export function InlineLoader({ label, className }: InlineLoaderProps) {
  return (
    <span
      role="status"
      className={cn(
        'relative inline-flex h-[34px] min-w-[170px] items-center justify-center overflow-hidden',
        'rounded-[var(--ot-radius-pill)] bg-[var(--ot-water-2)] px-4',
        className,
      )}
    >
      <BubbleField pattern="shallow" />
      <span className="relative text-[12px] font-semibold text-[var(--ot-text-2)]">{label}</span>
    </span>
  )
}

export interface LoaderDotsProps {
  label: string
  className?: string
}

/**
 * Three plan-blue dots and a word. The loader that fits on one line — beside a
 * table heading, inside a status chip's row, in a cell.
 *
 * This is also the text-only fallback the design names: when motion is off the
 * dots hold still and the label carries the whole message.
 */
export function LoaderDots({ label, className }: LoaderDotsProps) {
  return (
    <span
      role="status"
      className={cn('inline-flex items-center gap-[6px] text-[13px] text-[var(--ot-text-3)]', className)}
    >
      <span aria-hidden className="inline-flex gap-1">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="ot-dot h-[6px] w-[6px] rounded-full bg-[var(--ot-plan)]"
            style={{ animationDelay: `${i * 0.2}s` }}
          />
        ))}
      </span>
      {label}
    </span>
  )
}

export interface BadgeLoaderProps {
  label: string
  className?: string
}

/**
 * The badge pulsing beside a line of text, shaped like a button that cannot be
 * pressed. Use it where a button used to be — after "Build the plan" is
 * clicked, in place of the control that started the wait.
 *
 * Icon tier at 24px: the outlined badge turns to mud below that, and the design
 * never animates a badge smaller than 24px at all.
 */
export function BadgeLoader({ label, className }: BadgeLoaderProps) {
  return (
    <span
      role="status"
      className={cn(
        'inline-flex items-center gap-[10px] rounded-[var(--ot-radius-pill)]',
        'border border-[var(--ot-border-strong)] bg-[var(--ot-card)] py-[9px] pl-3 pr-4',
        'text-[14px] font-semibold text-[var(--ot-text-2)]',
        className,
      )}
    >
      <OttoBadge tier="icon" size={24} className="ot-badge-pulse" />
      {label}
    </span>
  )
}
