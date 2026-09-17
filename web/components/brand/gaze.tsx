'use client'

import { useEffect, useRef, type ReactNode } from 'react'
import { useStillness } from '@/components/motion'
import { watchPointer } from '@/lib/pointer'
import { cn } from '@/lib/cn'

/**
 * The design system's ceiling for a pupil: "#pupils translate ≤3u look".
 * Three user units out of a hundred is a glance, not a stare — past it the
 * pupils leave the whites and Otto looks alarmed.
 */
const MAX_TRAVEL = 3

/**
 * The distance at which the gaze is at full stretch. Nearer than this and Otto
 * is still tracking; further and he has already looked as far as he will.
 */
const REACH_PX = 420

export interface GazeProps {
  children: ReactNode
  /** Maximum pupil travel in SVG user units. */
  max?: number
  className?: string
}

/**
 * Otto's eyes follow the pointer.
 *
 * Wraps any mascot rather than living inside one, so it works for the badge and
 * for the full Otto without either knowing about it: it finds the
 * `[data-part="pupils"]` group in its own subtree and moves that.
 *
 * Written straight to the DOM in a rAF callback, never through React state. The
 * pointer moves at screen refresh rate, and re-rendering a component tree at
 * that rate to shift two circles by three units would be the most expensive
 * thing on the page.
 *
 * Ambient motion, so it obeys the same two rules as the water: nothing moves
 * under `prefers-reduced-motion`, and nothing moves inside a held region. It
 * also has no place on a surface carrying an address, an amount or an approval
 * — Otto looking around behind a number is exactly what the ocean-layer rule
 * forbids.
 */
export function Gaze({ children, max = MAX_TRAVEL, className }: GazeProps) {
  const ref = useRef<HTMLSpanElement>(null)
  const held = useStillness()

  useEffect(() => {
    if (held) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

    const root = ref.current
    const svg = root?.querySelector('svg')
    const pupils = root?.querySelector<SVGGElement>('[data-part="pupils"]')
    if (!svg || !pupils) return

    // Transforms on an SVG child are in user units once the box is the view
    // box, which is what lets the same three-unit budget hold at any size.
    pupils.style.transformBox = 'view-box'
    pupils.style.transformOrigin = 'center'

    let idleStopped = false

    const stop = watchPointer((px, py) => {
      const box = svg.getBoundingClientRect()
      if (box.width === 0) return

      // The idle glance loop is a CSS animation, and a running animation beats
      // an inline style. Standing it down is what hands control over — and it
      // only happens once a pointer has actually moved, so a touch device
      // keeps the loop it was given.
      if (!idleStopped) {
        pupils.style.animation = 'none'
        idleStopped = true
      }

      const dx = px - (box.left + box.width / 2)
      const dy = py - (box.top + box.height / 2)
      const distance = Math.hypot(dx, dy) || 1
      // Clamped by distance as well as direction: a pointer at the far edge of
      // a wide screen should not pin the eyes any harder than one nearby.
      const reach = Math.min(1, distance / REACH_PX)
      const travel = max * reach

      pupils.style.transform = `translate(${((dx / distance) * travel).toFixed(2)}px, ${(
        (dy / distance) *
        travel
      ).toFixed(2)}px)`
    })

    return () => {
      stop()
      pupils.style.transform = ''
      pupils.style.animation = ''
    }
  }, [held, max])

  return (
    <span ref={ref} className={cn('inline-flex', className)}>
      {children}
    </span>
  )
}
