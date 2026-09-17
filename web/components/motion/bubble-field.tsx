'use client'

import { cn } from '@/lib/cn'
import { useStillness } from './stillness'

/**
 * The cap. The design never draws more than four at once, in any placement —
 * past that it stops reading as breath and starts reading as an aquarium.
 */
export const MAX_BUBBLES = 4

export interface Bubble {
  /** Percentage across the container. */
  left: number
  /** Pixels up from the bottom edge. */
  bottom: number
  size: number
  delay: number
  duration: number
}

export const BUBBLE_PATTERNS = ['canvas', 'breath', 'calm', 'shallow'] as const

export type BubblePattern = (typeof BUBBLE_PATTERNS)[number]

/**
 * Positions are transcribed from the design, not generated. They are drawn —
 * the spacing is uneven on purpose, and an even distribution reads as a
 * progress indicator rather than as water.
 */
export const BUBBLE_LAYOUTS: Record<BubblePattern, readonly Bubble[]> = {
  /** Page canvas: marketing, auth, onboarding. Three, slow, and that is all. */
  canvas: [
    { left: 8, bottom: 0, size: 9, delay: 0, duration: 7 },
    { left: 46, bottom: 0, size: 5, delay: 2.6, duration: 8 },
    { left: 88, bottom: 0, size: 7, delay: 4.4, duration: 6.5 },
  ],
  /** Otto's breath. Rises from the dome, which is why the loader feels patient. */
  breath: [
    { left: 32, bottom: 74, size: 9, delay: 0, duration: 2.6 },
    { left: 58, bottom: 78, size: 6, delay: 0.55, duration: 2.6 },
    { left: 44, bottom: 82, size: 4, delay: 1.15, duration: 2.6 },
    { left: 70, bottom: 72, size: 5, delay: 1.7, duration: 2.6 },
  ],
  /** Empty states. Eight-second cycles — you notice it only if you look. */
  calm: [
    { left: 12, bottom: 0, size: 6, delay: 1.2, duration: 7.5 },
    { left: 88, bottom: 0, size: 5, delay: 3.6, duration: 8.2 },
  ],
  /** Inside the inline loader pill. Short travel, or they leave the container. */
  shallow: [
    { left: 14, bottom: 2, size: 7, delay: 0, duration: 2.2 },
    { left: 38, bottom: 2, size: 5, delay: 0.5, duration: 2.2 },
    { left: 62, bottom: 2, size: 8, delay: 1, duration: 2.2 },
    { left: 84, bottom: 2, size: 4, delay: 1.5, duration: 2.2 },
  ],
}

export interface BubbleFieldProps {
  pattern?: BubblePattern
  /**
   * Clips to the container. Off for `breath`, where the bubbles start at Otto's
   * dome and are meant to leave the top of his box.
   */
  clip?: boolean
  className?: string
}

/**
 * Rising bubbles, absolutely positioned over whatever contains them.
 *
 * Water lives in three places only — the page canvas, empty states, and
 * loaders. It never goes behind an address, an amount or an approval: a moving
 * background makes numbers harder to trust, and this is a product where people
 * read numbers before signing them.
 *
 * Nothing renders while the water is held. The CSS gate alone would freeze the
 * bubbles at their first keyframe, which is fully transparent — so they would
 * be invisible but still in the tree. Better to say so in the markup.
 */
export function BubbleField({ pattern = 'canvas', clip = true, className }: BubbleFieldProps) {
  const held = useStillness()
  if (held) return null

  const bubbles = BUBBLE_LAYOUTS[pattern].slice(0, MAX_BUBBLES)
  const shallow = pattern === 'shallow'

  return (
    <div
      aria-hidden
      className={cn(
        'pointer-events-none absolute inset-0',
        clip ? 'overflow-hidden' : 'overflow-visible',
        className,
      )}
    >
      {bubbles.map((b, i) => (
        <span
          key={`${pattern}-${i}`}
          className={cn('ot-bubble', shallow && 'ot-bubble--shallow')}
          style={{
            left: `${b.left}%`,
            bottom: `${b.bottom}px`,
            width: `${b.size}px`,
            height: `${b.size}px`,
            animationDelay: `${b.delay}s`,
            animationDuration: `${b.duration}s`,
          }}
        />
      ))}
    </div>
  )
}
