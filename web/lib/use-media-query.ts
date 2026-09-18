'use client'

import { useCallback, useSyncExternalStore } from 'react'

/**
 * Whether a media query matches, kept live.
 *
 * `false` on the server and during hydration: the server has no viewport, and
 * guessing "phone" would render a sheet-shaped control into HTML a desktop then
 * has to unpick. useSyncExternalStore re-renders with the real answer as soon
 * as the client has one, without a hydration mismatch, because hydration is
 * done against the server snapshot rather than the live one.
 *
 * Callers should only let this change what happens on interaction, never what
 * is on screen at rest — a trigger that looks the same in both modes and only
 * opens something different is safe; one that renders a different trigger
 * flashes on every phone load.
 */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const list = window.matchMedia(query)
      list.addEventListener('change', onChange)
      return () => list.removeEventListener('change', onChange)
    },
    [query],
  )
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => false,
  )
}
