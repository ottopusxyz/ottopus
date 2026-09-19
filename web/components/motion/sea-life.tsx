'use client'

import type { CSSProperties, ReactNode } from 'react'
import { cn } from '@/lib/cn'
import { useStillness } from './stillness'

export const SEA_SPECIES = ['fish', 'jelly', 'crab', 'turtle'] as const

export type SeaSpecies = (typeof SEA_SPECIES)[number]

/**
 * The cap. BubbleField draws the line at four bubbles; sea life is larger and
 * more legible than a bubble, so a section beside a table stops at three.
 * Six is the ceiling for a page whose gutters are the only thing the water
 * has to fill — past that it reads as an aquarium rather than as water.
 */
export const MAX_SEA_LIFE = 6

export interface SeaCreature {
  species: SeaSpecies
  /** Percentage across the container. */
  left: number
  /** Percentage down the container. */
  top: number
  /** Longest edge, in pixels. Small on purpose — this is scenery. */
  size: number
  /** Pixels it drifts sideways over one run. Negative goes left. */
  travel: number
  /** Pixels it rises over one run. Negative goes up. */
  lift: number
  delay: number
  duration: number
  /** Its ceiling, never reached at the ends of a run. */
  opacity: number
}

interface Shape {
  w: number
  h: number
  body: ReactNode
}

/**
 * Silhouettes. No eyes, no mouths — the water layer is scenery, and the design
 * gives faces to Otto alone.
 */
const SHAPES: Record<SeaSpecies, Shape> = {
  fish: {
    w: 23,
    h: 14,
    body: (
      <>
        <ellipse cx="9" cy="7" rx="7" ry="4.4" fill="currentColor" />
        <path d="M15.4 7 22.5 2.8v8.4L15.4 7Z" fill="currentColor" opacity=".8" />
        <path d="M9 2.7 11.7.7l.5 2.6Z" fill="currentColor" opacity=".65" />
      </>
    ),
  },
  jelly: {
    w: 18,
    h: 24,
    body: (
      <>
        <path d="M1 10.5C1 5.8 4.6 2 9 2s8 3.8 8 8.5v1.4c0 .6-.5 1.1-1.1 1.1H2.1A1.1 1.1 0 0 1 1 11.9v-1.4Z" fill="currentColor" />
        <path
          d="M4.4 13.8c0 3-1.3 4.3-1.3 7.1M7.5 13.8c0 3.6.8 5 .2 7.9M10.5 13.8c0 3.6-.8 5-.2 7.9M13.6 13.8c0 3 1.3 4.3 1.3 7.1"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.2"
          strokeLinecap="round"
          opacity=".7"
        />
      </>
    ),
  },
  turtle: {
    w: 28,
    h: 16,
    body: (
      <>
        <ellipse cx="12" cy="8" rx="8.2" ry="5.4" fill="currentColor" />
        <circle cx="22.6" cy="8.2" r="2.7" fill="currentColor" opacity=".9" />
        <path
          d="M7 3.4 3.6 1.2M7 12.6 3.6 14.8M17 3.6l3.2-2.2M17 12.4l3.2 2.2"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          opacity=".8"
        />
      </>
    ),
  },
  crab: {
    w: 22,
    h: 14,
    body: (
      <>
        <ellipse cx="11" cy="8.2" rx="5.6" ry="3.8" fill="currentColor" />
        <path
          d="M5 4.8A2.3 2.3 0 1 0 3.2 8.4M17 4.8A2.3 2.3 0 1 1 18.8 8.4"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
        />
        <path
          d="m6.7 11.2-2 2.1M9.1 12v1.6M12.9 12v1.6M15.3 11.2l2 2.1"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.2"
          strokeLinecap="round"
          opacity=".85"
        />
      </>
    ),
  },
}

/**
 * The drawn arrangement, not a generated one — the same rule BubbleField
 * follows. Drawn for the lower half of a tall column, because the top of one is
 * usually where a caller has put something to read.
 */
export const SEA_LIFE: readonly SeaCreature[] = [
  { species: 'fish', left: 8, top: 46, size: 22, travel: 150, lift: -14, delay: 0, duration: 52, opacity: 0.85 },
  { species: 'jelly', left: 66, top: 64, size: 24, travel: 16, lift: -110, delay: 7, duration: 38, opacity: 0.7 },
  { species: 'crab', left: 16, top: 92, size: 20, travel: 62, lift: 0, delay: 3, duration: 30, opacity: 0.8 },
]

export interface SeaLifeProps {
  creatures?: readonly SeaCreature[]
  className?: string
}

/**
 * Small creatures drifting behind whatever contains them.
 *
 * The same contract as BubbleField: absolutely positioned, aria-hidden, inert,
 * and gone entirely when the water is held — the CSS gate alone would freeze
 * them mid-swim, which reads as a stall rather than as calm.
 */
export function SeaLife({ creatures = SEA_LIFE, className }: SeaLifeProps) {
  const held = useStillness()
  if (held) return null

  return (
    <div aria-hidden className={cn('pointer-events-none absolute inset-0 overflow-hidden', className)}>
      {creatures.slice(0, MAX_SEA_LIFE).map((creature, i) => {
        const shape = SHAPES[creature.species]
        const scale = creature.size / Math.max(shape.w, shape.h)
        return (
          <svg
            key={`${creature.species}-${i}`}
            viewBox={`0 0 ${shape.w} ${shape.h}`}
            width={shape.w * scale}
            height={shape.h * scale}
            className={cn(
              'ot-sea-life',
              `ot-sea-life--${creature.species}`,
              (creature.species === 'jelly' || creature.species === 'crab') && 'ot-sea-life--warm',
            )}
            style={{
              left: `${creature.left}%`,
              top: `${creature.top}%`,
              animationDelay: `${creature.delay}s`,
              '--ot-sea-travel': `${creature.travel}px`,
              '--ot-sea-lift': `${creature.lift}px`,
              '--ot-sea-dur': `${creature.duration}s`,
              '--ot-sea-opacity': creature.opacity,
            } as CSSProperties}
          >
            {shape.body}
          </svg>
        )
      })}
    </div>
  )
}
