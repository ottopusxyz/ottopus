'use client'

import { useEffect, useRef, useState } from 'react'

/**
 * Draw once at a fixed design width, then scale to whatever column it lands
 * in. The landing page's scenes are compositions, not layouts: a card placed
 * beside Otto has to stay beside Otto at every width, and a uniform scale is
 * the one thing that guarantees it.
 */
export function useFit<T extends HTMLElement>(width: number) {
  const ref = useRef<T>(null)
  const [scale, setScale] = useState(1)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => {
      if (entry) setScale(entry.contentRect.width / width)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [width])

  return { ref, scale }
}
