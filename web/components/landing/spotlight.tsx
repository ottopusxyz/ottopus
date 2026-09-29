'use client'

import type { HTMLAttributes, PointerEvent } from 'react'
import { cn } from '@/lib/cn'

/**
 * A card with a soft light that follows the pointer across it. The light is a
 * pseudo-element in landing.css reading --ot-mx and --ot-my; this only keeps
 * those two numbers current. Touch has no hover, so it simply never lights.
 */
export function Spotlight({ className, children, ...props }: HTMLAttributes<HTMLDivElement>) {
  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    if (e.pointerType !== 'mouse') return
    const box = e.currentTarget.getBoundingClientRect()
    e.currentTarget.style.setProperty('--ot-mx', `${e.clientX - box.left}px`)
    e.currentTarget.style.setProperty('--ot-my', `${e.clientY - box.top}px`)
  }
  return (
    <div onPointerMove={onMove} className={cn('ot-spot', className)} {...props}>
      {children}
    </div>
  )
}
