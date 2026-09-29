'use client'

import { useEffect, useRef, type CSSProperties, type ElementType, type ReactNode } from 'react'

/**
 * Lifts its content in as it scrolls into view, once.
 *
 * The server renders it with no state at all, so without JavaScript it is
 * simply there. On mount it hides only if it is still below the fold — a
 * section already on screen is never blanked and redrawn — and with reduced
 * motion it never hides. The CSS lives in landing.css under [data-reveal].
 *
 * The attribute is written straight onto the element rather than held in
 * React state: it is a presentation flag the observer owns, and a re-render
 * per section for it would buy nothing.
 */
export function Reveal({
  as: Tag = 'div',
  index = 0,
  className,
  children,
}: {
  as?: ElementType
  /** Position in a staggered group; each step waits a little longer. */
  index?: number
  className?: string
  children: ReactNode
}) {
  const ref = useRef<HTMLElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    // Reduced motion lands at the end state at once: the struck-through lines
    // mean something, so they are struck, just not animated.
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const below = el.getBoundingClientRect().top > window.innerHeight * 0.92
    if (still || !below) {
      el.dataset.reveal = 'in'
      return
    }
    el.dataset.reveal = 'out'
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          el.dataset.reveal = 'in'
          io.disconnect()
        }
      },
      { rootMargin: '0px 0px -12% 0px' },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [])

  return (
    <Tag ref={ref} className={className} style={{ '--i': index } as CSSProperties}>
      {children}
    </Tag>
  )
}
