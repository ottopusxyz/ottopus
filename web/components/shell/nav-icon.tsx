import type { ReactNode } from 'react'
import type { NavIconName } from './routes'

/**
 * The four nav glyphs, for the bottom bar.
 *
 * Drawn here rather than pulled from an icon set: four shapes is not worth a
 * dependency, and a set would arrive with two hundred more and a second visual
 * language. They share one grid — a 24px box, a 1.7 stroke, round caps — so
 * they sit at the same weight beside each other, which is the only thing that
 * makes a row of icons read as a set.
 *
 * The sidebar stays text. The design draws it that way, and a 216px column has
 * room to say the word; a 25%-wide tab does not.
 */
const GLYPHS: Record<NavIconName, ReactNode> = {
  // Allocation, not a wallet: this page is the split across everything you
  // hold, and a wallet glyph would promise the wallets tab.
  portfolio: (
    <>
      <circle cx="12" cy="12" r="8.25" />
      <path d="M12 3.75V12h8.25" />
    </>
  ),
  // An inbox. Things arrive here and wait for you, which is the whole page.
  requests: (
    <>
      <path d="M4 13.5 6.7 5.9A2.1 2.1 0 0 1 8.7 4.5h6.6a2.1 2.1 0 0 1 2 1.4L20 13.5" />
      <path d="M4 13.5h4.2l1.2 2.2h5.2l1.2-2.2H20v3.6a2.4 2.4 0 0 1-2.4 2.4H6.4A2.4 2.4 0 0 1 4 17.1v-3.6Z" />
    </>
  ),
  // A trace. The one page that is a record over time.
  activity: <path d="M3 12h3.9l2.4-6.4 4.2 12.4 2.4-6h5.1" />,
  // Sliders rather than a gear: this page is choices you set, and a gear at
  // 20px is a ring of teeth that turns to mud.
  settings: (
    <>
      <path d="M3.75 8.25h7.5M15.75 8.25h4.5M3.75 15.75h3.75M12 15.75h8.25" />
      <circle cx="13.5" cy="8.25" r="2.25" />
      <circle cx="9.75" cy="15.75" r="2.25" />
    </>
  ),
}

/** Decorative: the label beside it is the accessible name. */
export function NavIcon({ name, className }: { name: NavIconName; className?: string }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      {GLYPHS[name]}
    </svg>
  )
}

/** The test asserts every route has one of these. */
export const NAV_ICON_NAMES = Object.keys(GLYPHS) as NavIconName[]
