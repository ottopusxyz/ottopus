'use client'

import { useId } from 'react'
import { cn } from '@/lib/cn'

const INK = '#16213E'
const BAND = '#FFF0DC'

export type BadgeTier = 'outlined' | 'icon'

export interface OttoBadgeProps {
  /**
   * "icon" drops the outer ring and the eye highlights, which turn to mud below
   * 24px. The design system: icon tier under 24px, outlined at 24 and above.
   */
  tier?: BadgeTier
  size?: number
  /** Single-colour treatment for reversed and one-ink contexts. */
  mono?: boolean
  monoColor?: string
  label?: string
  className?: string
}

/**
 * The badge — Otto's head, cropped to a disc. Transcribed from OttoBadge.dc.html.
 *
 * This is what a lockup, an avatar and a favicon use. Never the full mascot:
 * eight arms at 32px is a smudge.
 */
export function OttoBadge({
  tier = 'outlined',
  size = 32,
  mono = false,
  monoColor = INK,
  label,
  className,
}: OttoBadgeProps) {
  const body = 'var(--ot-coral)'
  // Unique per instance. A page renders several badges, and a shared clip id
  // means every url(#…) resolves to whichever one the browser saw first — fine
  // while the geometry matches, silently wrong the moment a variant differs.
  const clipId = `otto-badge-${useId().replace(/:/g, '')}`

  return (
    <svg
      viewBox="0 0 100 100"
      width={size}
      height={size}
      className={cn('block', className)}
      role={label ? 'img' : 'presentation'}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      {mono ? (
        <g>
          <defs>
            <clipPath id={clipId}>
              <circle cx="50" cy="50" r="43" />
            </clipPath>
          </defs>
          <g clipPath={`url(#${clipId})`}>
            <path
              d="M2 68 Q16 56 28 68 Q40 80 50 68 Q60 56 72 68 Q84 80 98 66 L98 102 L2 102 Z"
              fill={monoColor}
            />
          </g>
          <circle cx="50" cy="50" r="43" fill="none" stroke={monoColor} strokeWidth={6} />
          <circle cx="35" cy="41" r="10.5" fill="none" stroke={monoColor} strokeWidth={5} />
          <circle cx="65" cy="41" r="10.5" fill="none" stroke={monoColor} strokeWidth={5} />
          <circle cx="37" cy="43" r="4" fill={monoColor} />
          <circle cx="67" cy="43" r="4" fill={monoColor} />
        </g>
      ) : tier === 'icon' ? (
        <g>
          <defs>
            <clipPath id={clipId}>
              <circle cx="50" cy="50" r="46" />
            </clipPath>
          </defs>
          <circle cx="50" cy="50" r="46" fill={body} />
          <g clipPath={`url(#${clipId})`}>
            <path
              d="M0 70 Q16 57 30 70 Q44 83 54 70 Q66 56 80 70 Q90 79 100 68 L100 104 L0 104 Z"
              fill={BAND}
            />
          </g>
          <circle cx="34" cy="41" r="11" fill="#fff" />
          <circle cx="66" cy="41" r="11" fill="#fff" />
          <circle cx="36" cy="42" r="6" fill={INK} />
          <circle cx="68" cy="42" r="6" fill={INK} />
        </g>
      ) : (
        <g>
          <defs>
            <clipPath id={clipId}>
              <circle cx="50" cy="50" r="43" />
            </clipPath>
          </defs>
          <circle cx="50" cy="50" r="43" fill={body} />
          <g clipPath={`url(#${clipId})`}>
            <path
              d="M2 68 Q16 56 28 68 Q40 80 50 68 Q60 56 72 68 Q84 80 98 66 L98 102 L2 102 Z"
              fill={BAND}
            />
            <g fill={body} opacity={0.85}>
              <circle cx="24" cy="82" r="4" />
              <circle cx="50" cy="86" r="4" />
              <circle cx="76" cy="82" r="4" />
            </g>
          </g>
          <circle cx="50" cy="50" r="43" fill="none" stroke={INK} strokeWidth={6} />
          <circle cx="35" cy="41" r="12" fill="#fff" stroke={INK} strokeWidth={4.5} />
          <circle cx="65" cy="41" r="12" fill="#fff" stroke={INK} strokeWidth={4.5} />
          <circle cx="37" cy="43" r="6" fill={INK} />
          <circle cx="67" cy="43" r="6" fill={INK} />
          <circle cx="34" cy="39" r="2.2" fill="#fff" />
          <circle cx="64" cy="39" r="2.2" fill="#fff" />
        </g>
      )}
    </svg>
  )
}
