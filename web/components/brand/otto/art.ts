/**
 * Otto's art, ported from the design project. The art is authoritative — these
 * paths are transcribed, never redrawn.
 *
 * Stored as data rather than seven near-identical SVG files: every state shares
 * the same body and differs only in arms, gaze, brows, mouth and props. The
 * renderer rebuilds the documented structure — <g id="otto"> wrapping arm-1 to
 * arm-8, each with its own transform-origin — so individual arms stay
 * addressable for the planning sweep and the ink cloud.
 */

export interface Arm {
  /** Path shared by the navy outline and the coral fill. */
  d: string
  /** transform-origin, so the arm rotates from where it meets the body. */
  o: string
  /** Thinner front arm, and the only one carrying suckers. */
  front?: boolean
}

export interface OttoArt {
  arms: Arm[]
  /** [x, y] of each pupil; the whites stay put, the gaze moves. */
  pupils: [number, number][]
  brows: [string, string]
  mouth: string
  /** State-specific extras: a coin, an ink cloud, a tick. */
  prop?: string
}

const SUCKER_ARM: Arm = { d: 'M62 128 C50 144 60 162 82 160', o: '62px 128px', front: true }

export const OTTO_ART = {
  base: {
    arms: [
      { d: 'M50 126 C26 138 14 154 20 172', o: '50px 126px' },
      { d: 'M72 140 C58 158 56 176 66 184', o: '72px 140px' },
      { d: 'M96 144 C92 164 100 180 116 184', o: '96px 144px' },
      { d: 'M122 142 C136 160 150 172 166 172', o: '122px 142px' },
      { d: 'M144 130 C164 142 176 158 172 176', o: '144px 130px' },
      { d: 'M154 110 C184 100 196 72 186 48', o: '154px 110px' },
      { d: 'M44 112 C22 110 8 122 8 142', o: '44px 112px' },
      SUCKER_ARM,
    ],
    pupils: [
      [82, 78],
      [124, 78],
    ],
    brows: ['M66 52 Q79 44 91 51', 'M109 51 Q121 44 134 52'],
    mouth: 'M91 101 Q100 110 109 101',
  },
} satisfies Record<string, OttoArt>
