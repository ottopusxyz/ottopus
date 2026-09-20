'use client'

import { useEffect, useState } from 'react'
import { Otto, type PoseName } from '@/components/brand'
import { useMediaQuery } from '@/lib/use-media-query'

/**
 * Otto working through the product's loop, on the landing page alone: he
 * picks a wallet, simulates, and is ready to sign, with a word for each. All
 * three drawings already exist; this only turns the pages.
 *
 * With reduced motion the loop does not run and he stays ready, which is
 * the pose the page led with before.
 */
const BEATS: readonly { pose: PoseName; caption: string; ms: number }[] = [
  { pose: 'planning', caption: 'Picking a wallet…', ms: 2600 },
  { pose: 'simulating', caption: 'Simulating…', ms: 2600 },
  { pose: 'plan-ready', caption: 'Ready to sign', ms: 3600 },
]

export function HeroOtto({ className }: { className?: string }) {
  const still = useMediaQuery('(prefers-reduced-motion: reduce)')
  const [beat, setBeat] = useState(0)

  useEffect(() => {
    if (still) return
    let i = 0
    let timer: ReturnType<typeof setTimeout>
    const next = () => {
      i = (i + 1) % BEATS.length
      setBeat(i)
      timer = setTimeout(next, BEATS[i]!.ms)
    }
    timer = setTimeout(next, BEATS[0]!.ms)
    return () => clearTimeout(timer)
  }, [still])

  const current = BEATS[still ? BEATS.length - 1 : beat]!
  return (
    <div className={className}>
      <div className="ot-drift">
        <Otto pose={current.pose} size={280} animated className="h-auto w-[200px] max-w-full sm:w-[240px] lg:w-[280px]" />
      </div>
      <p
        aria-live="polite"
        className="mt-3 text-center font-mono text-[12px] tracking-[0.02em] text-[var(--ot-text-2)] tabular-nums"
      >
        <span
          key={current.pose}
          className="inline-block rounded-full border border-[var(--ot-border)] bg-[color-mix(in_srgb,var(--ot-card)_80%,transparent)] px-3 py-1 motion-safe:animate-[ot-fade-in_0.4s_ease-out]"
        >
          {current.caption}
        </span>
      </p>
    </div>
  )
}
