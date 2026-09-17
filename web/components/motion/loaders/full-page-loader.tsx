'use client'

import { useEffect, useState } from 'react'
import { Otto } from '@/components/brand'
import { cn } from '@/lib/cn'
import { TideBar } from './tide-bar'

/** The design: "copy swaps every 2.5s". */
const SWAP_MS = 2500

/** And "≥8s adds 'Still going — deep water today.'" */
const PATIENCE_MS = 8000

const STILL_GOING = 'Still going — deep water today.'

/** Four bubbles, exactly as the design places them. */
const BUBBLES = [
  { left: 12, bottom: 0, size: 8, delay: 0, duration: 4.2 },
  { left: 31, bottom: 12, size: 5, delay: 1.1, duration: 3.4 },
  { left: 68, bottom: 6, size: 6, delay: 0.6, duration: 3.8 },
  { left: 87, bottom: 18, size: 4, delay: 1.9, duration: 3 },
]

export interface FullPageLoaderProps {
  title?: string
  /**
   * Swapped every 2.5 seconds. Say what is actually happening — the design's
   * own example counts wallets and chains rather than saying "Loading…".
   */
  messages?: readonly string[]
  className?: string
}

/**
 * L4 · Full page — the only loader that gets the full mascot and the full ocean.
 *
 * One per session, on cold boot. Never on navigation: a page transition that
 * blanks the screen for a floating octopus is slower than one that does not,
 * however good the octopus is.
 *
 * The copy rotates because a message that never changes stops being read, and
 * after eight seconds it admits the wait is long rather than pretending
 * otherwise. Both are in the design.
 */
export function FullPageLoader({
  title = 'Getting your ocean in order',
  messages = ['One moment.'],
  className,
}: FullPageLoaderProps) {
  const [index, setIndex] = useState(0)
  const [patient, setPatient] = useState(false)

  useEffect(() => {
    if (messages.length > 1) {
      const swap = setInterval(() => setIndex((i) => (i + 1) % messages.length), SWAP_MS)
      const slow = setTimeout(() => setPatient(true), PATIENCE_MS)
      return () => {
        clearInterval(swap)
        clearTimeout(slow)
      }
    }
    const slow = setTimeout(() => setPatient(true), PATIENCE_MS)
    return () => clearTimeout(slow)
  }, [messages.length])

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        'relative flex min-h-dvh flex-col items-center justify-center gap-4 overflow-hidden',
        className,
      )}
      style={{
        background:
          'linear-gradient(180deg, var(--ot-water-1) 0%, var(--ot-water-2) 55%, var(--ot-water-3) 100%)',
      }}
    >
      {/* Two caustic washes rather than water.css's one: this is the only
          surface that gets the ocean at full strength. */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(120% 60% at 20% -10%, var(--ot-caustic), transparent 60%),' +
            'radial-gradient(90% 50% at 85% 110%, var(--ot-caustic), transparent 60%)',
        }}
      />
      <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
        {BUBBLES.map((b, i) => (
          <span
            key={i}
            className="ot-bubble"
            style={{
              left: `${b.left}%`,
              bottom: `${b.bottom}px`,
              width: b.size,
              height: b.size,
              animationDelay: `${b.delay}s`,
              animationDuration: `${b.duration}s`,
            }}
          />
        ))}
      </div>

      <div className="ot-float relative">
        {/* The juggling pose: the design's L4 holds props in the air. */}
        <Otto pose="loader" size={118} animated />
      </div>

      <div className="relative flex flex-col items-center gap-2 px-6 text-center">
        <p className="font-display m-0 text-[19px] font-bold">{title}</p>
        <p className="m-0 text-[13px] text-[var(--ot-text-2)]">
          {patient ? STILL_GOING : messages[index]}
        </p>
        <TideBar className="mt-[2px] w-[160px] rounded-[999px]" height={4} label={title} />
      </div>
    </div>
  )
}
