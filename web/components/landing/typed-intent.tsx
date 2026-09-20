'use client'

import { useEffect, useState } from 'react'
import { useMediaQuery } from '@/lib/use-media-query'

/**
 * What you would say to your agent, typed as you would type it. The same
 * kind of line the intent nudge offers inside the app, so the landing page
 * and the product feel like one thing. With reduced motion the first line
 * simply stands there.
 */
export const TYPED_INTENTS: readonly string[] = [
  'Swap 500 USDC for ETH',
  'Buy $100 of Tesla stock on chain',
  'Get me the cheapest $1,000 loan on Base',
  'Send 0.1 ETH to koshik.eth',
  'Move my idle USDC to the best yield',
  'Revoke every unlimited approval I have',
  'Bridge 50 USDC to Arbitrum',
]

const TYPE_MS = 46
const ERASE_MS = 18
const HOLD_MS = 2200
const REST_MS = 500

export function TypedIntent({ className }: { className?: string }) {
  const still = useMediaQuery('(prefers-reduced-motion: reduce)')
  const [shown, setShown] = useState(TYPED_INTENTS[0]!)

  useEffect(() => {
    if (still) return
    // The first line is already standing there from the server render, so
    // the loop begins by erasing it rather than by blanking the page.
    let line = 0
    let length = TYPED_INTENTS[0]!.length
    let erasing = true
    let timer: ReturnType<typeof setTimeout>
    const tick = () => {
      const text = TYPED_INTENTS[line]!
      if (!erasing) {
        length++
        setShown(text.slice(0, length))
        if (length === text.length) {
          erasing = true
          timer = setTimeout(tick, HOLD_MS)
          return
        }
        timer = setTimeout(tick, TYPE_MS)
        return
      }
      length--
      setShown(text.slice(0, length))
      if (length === 0) {
        erasing = false
        line = (line + 1) % TYPED_INTENTS.length
        timer = setTimeout(tick, REST_MS)
        return
      }
      timer = setTimeout(tick, ERASE_MS)
    }
    timer = setTimeout(tick, HOLD_MS)
    return () => clearTimeout(timer)
  }, [still])

  return (
    <p className={className} aria-label={`For example: ${TYPED_INTENTS.join('; ')}`}>
      <span aria-hidden className="mr-2 text-[var(--ot-coral)]">›</span>
      <span aria-hidden>{still ? TYPED_INTENTS[0] : shown}</span>
      {still ? null : (
        <span aria-hidden className="ml-px inline-block h-[1.1em] w-[2px] translate-y-[0.2em] bg-[var(--ot-coral)] motion-safe:animate-pulse" />
      )}
    </p>
  )
}
