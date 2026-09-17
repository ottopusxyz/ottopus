'use client'

import { createContext, useContext, type HTMLAttributes } from 'react'

const StillnessContext = createContext(false)

/**
 * True when the surrounding water has been held still.
 *
 * Most ambient motion needs nothing from this — CSS handles it, because
 * `data-stillness="held"` flips `--ot-ambient-play` and that inherits. Read it
 * only where a component has to make a rendering decision, like not mounting
 * bubbles at all.
 */
export function useStillness(): boolean {
  return useContext(StillnessContext)
}

export interface StillnessProviderProps extends HTMLAttributes<HTMLDivElement> {
  /**
   * Hold the water. Set this on any region wrapping a plan that is risky,
   * expired, stale, or awaiting re-simulation.
   */
  held?: boolean
}

/**
 * Stops every ambient animation inside it.
 *
 * Calm is a signal, not a skin: ambient motion means "nothing needs you", so
 * stillness is how the product raises its voice. One risky plan halts
 * everything in its region, and the eye goes to the thing that stopped.
 *
 * Stillness only ever propagates downward. A nested provider can hold a smaller
 * region, but it cannot start the water moving again inside a held one — a
 * component deep in a risky plan should not be able to opt itself back into
 * motion. That is why nothing here ever writes `data-stillness="running"`.
 *
 * This renders a real element, because the CSS variable has to inherit from
 * somewhere. Pass className if it needs to carry layout.
 */
export function StillnessProvider({
  held = false,
  children,
  ...props
}: StillnessProviderProps) {
  const stopped = useContext(StillnessContext) || held

  return (
    <StillnessContext.Provider value={stopped}>
      <div data-stillness={stopped ? 'held' : undefined} {...props}>
        {children}
      </div>
    </StillnessContext.Provider>
  )
}
