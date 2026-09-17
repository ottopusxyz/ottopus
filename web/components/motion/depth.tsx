import type { HTMLAttributes } from 'react'
import { cn } from '@/lib/cn'

export const DEPTH_LEVELS = ['surface', 'shallow', 'mid', 'deep'] as const

export type DepthLevel = (typeof DEPTH_LEVELS)[number]

/** Four steps, each about 2% darker than the last. */
export const DEPTH_TOKENS: Record<DepthLevel, string> = {
  surface: 'var(--ot-card)',
  shallow: 'var(--ot-water-1)',
  mid: 'var(--ot-water-2)',
  deep: 'var(--ot-water-3)',
}

export interface DepthProps extends HTMLAttributes<HTMLDivElement> {
  level?: DepthLevel
  /** Rounds the surface. Off by default — nested layers usually sit flush. */
  rounded?: boolean
}

/**
 * A depth-tinted surface.
 *
 * Depth carries hierarchy where a border would add noise: the review layers,
 * nested detail, the technical drawer. It is the one part of the ocean layer
 * allowed anywhere, including behind an amount or calldata — because it does
 * not move. Nothing here animates, and nothing here should.
 */
export function Depth({ level = 'shallow', rounded = false, className, style, ...props }: DepthProps) {
  return (
    <div
      className={cn(rounded && 'rounded-[var(--ot-radius-md)]', className)}
      style={{ background: DEPTH_TOKENS[level], ...style }}
      {...props}
    />
  )
}
