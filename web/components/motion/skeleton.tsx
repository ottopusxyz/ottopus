import type { CSSProperties } from 'react'
import { cn } from '@/lib/cn'

/** The design's stagger between adjacent lines, in seconds. */
export const SWEEP_STAGGER = 0.25

/** Widths the design draws for a three-line block. */
export const SKELETON_LINES = ['62%', '88%', '40%'] as const

export interface SkeletonProps {
  /** Exact height of the content this stands in for. A number means pixels. */
  height?: number | string
  width?: number | string
  radius?: number
  /** Seconds. Offsets the sweep so a stack reads as a tide, not a bar. */
  delay?: number
  /**
   * Off for secondary lines. The design holds them at flat mid water so the
   * sweep stays on the primary line rather than the whole block strobing.
   */
  sweep?: boolean
  className?: string
  style?: CSSProperties
}

const px = (v: number | string) => (typeof v === 'number' ? `${v}px` : v)

/**
 * One placeholder block, sweeping.
 *
 * A slow tidal sweep, not a metallic shimmer — the point is that it does not
 * read as speed. Give it the exact height of what it replaces: a skeleton that
 * changes size when the real numbers arrive makes the page jump at precisely
 * the moment someone starts reading it.
 *
 * Decorative, so aria-hidden. SkeletonText does the announcing.
 */
export function Skeleton({
  height = 16,
  width = '100%',
  radius = 6,
  delay = 0,
  sweep = true,
  className,
  style,
}: SkeletonProps) {
  return (
    <div
      aria-hidden
      className={cn(sweep && 'ot-shimmer', className)}
      style={{
        height: px(height),
        width: px(width),
        borderRadius: `${radius}px`,
        ...(sweep
          ? { animationDelay: `${delay}s` }
          : { background: 'var(--ot-water-2)' }),
        ...style,
      }}
    />
  )
}

export interface SkeletonTextProps {
  /** Ignored when `widths` is given. */
  lines?: number
  widths?: readonly string[]
  lineHeight?: number
  /**
   * Announced once to screen readers. Say what is loading — "Loading balances"
   * beats "Loading" when three regions load at different speeds.
   */
  label?: string
  className?: string
}

/**
 * A stack of sweeping lines, and the only accessible part of a skeleton.
 *
 * The bars themselves are hidden: a screen reader gains nothing from four
 * nested divs. This wrapper carries aria-busy and one polite label, so a page
 * that is nothing but skeletons still says something.
 */
export function SkeletonText({
  lines = 3,
  widths,
  lineHeight = 16,
  label = 'Loading',
  className,
}: SkeletonTextProps) {
  const resolved =
    widths ??
    Array.from({ length: lines }, (_, i) => SKELETON_LINES[i % SKELETON_LINES.length])

  return (
    <div role="status" aria-busy className={cn('flex flex-col gap-[10px]', className)}>
      <span className="sr-only">{label}</span>
      {resolved.map((width, i) => (
        <Skeleton key={`${width}-${i}`} width={width} height={lineHeight} delay={i * SWEEP_STAGGER} />
      ))}
    </div>
  )
}

export interface SkeletonRowProps {
  /** Square placeholder on the left — a token logo, a wallet avatar. */
  avatar?: number
  label?: string
  className?: string
}

/**
 * The shape a list row loads in: one square, a sweeping title, a still
 * subtitle. Holds 44px so a portfolio row does not resize under the cursor.
 */
export function SkeletonRow({ avatar = 44, label = 'Loading', className }: SkeletonRowProps) {
  return (
    <div role="status" aria-busy className={cn('flex items-center gap-[10px]', className)}>
      <span className="sr-only">{label}</span>
      <Skeleton width={avatar} height={avatar} radius={10} />
      <div className="flex flex-1 flex-col justify-center gap-2">
        <Skeleton width="50%" height={12} sweep={false} />
        <Skeleton width="30%" height={12} sweep={false} />
      </div>
    </div>
  )
}
