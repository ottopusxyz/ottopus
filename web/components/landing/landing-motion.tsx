'use client'

import { ReactLenis } from 'lenis/react'
import 'lenis/dist/lenis.css'
import { MotionConfig, useReducedMotion } from 'motion/react'
import type { ReactNode } from 'react'

/**
 * The landing page's motion settings, and nowhere else's: the app shell and
 * the review page scroll natively. Smooth scroll is what lets a scrubbed
 * story read as film rather than as steps, and it is exactly what someone
 * who asked for reduced motion does not want, so it is simply not mounted
 * for them — and Motion is told to honour the same setting everywhere below.
 */
export function LandingMotion({ children }: { children: ReactNode }) {
  const reduce = useReducedMotion()
  return (
    <MotionConfig reducedMotion="user">
      {reduce ? null : <ReactLenis root options={{ lerp: 0.12, anchors: true }} />}
      {children}
    </MotionConfig>
  )
}
