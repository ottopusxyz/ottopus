'use client'

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'

/**
 * Where the nudge is right now, so it is only ever in one place.
 *
 * The sidebar carries a compact nudge on every route. The portfolio's rail
 * carries the full card when it has nothing else to show, and while it does
 * the sidebar's steps aside — two Ottos asking the same thing on one screen
 * would be a chorus, not a nudge. The page says so through this context
 * rather than the shell guessing from the route, because whether the rail
 * shows the card depends on the reading (DeFi or not) and the width.
 */
interface Placement {
  railShowing: boolean
  setRailShowing: (showing: boolean) => void
}

const NudgePlacement = createContext<Placement>({ railShowing: false, setRailShowing: () => {} })

export function NudgePlacementProvider({ children }: { children: ReactNode }) {
  const [railShowing, setRailShowing] = useState(false)
  const value = useMemo(() => ({ railShowing, setRailShowing }), [railShowing])
  return <NudgePlacement.Provider value={value}>{children}</NudgePlacement.Provider>
}

/** For the sidebar: whether it should draw its own nudge. */
export function useSidebarNudge(): boolean {
  return !useContext(NudgePlacement).railShowing
}

/** For a page: claim the nudge while `showing`, and let go when it stops or unmounts. */
export function useRailNudge(showing: boolean): void {
  const { setRailShowing } = useContext(NudgePlacement)
  useEffect(() => {
    setRailShowing(showing)
    return () => setRailShowing(false)
  }, [showing, setRailShowing])
}
