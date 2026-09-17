import type { ReactNode } from 'react'

/**
 * Otto's poses, transcribed from Otto.dc.html. The art is authoritative —
 * these paths are copied, never redrawn.
 *
 * Every pose is the same stack: seven back arms, the body, one front arm over
 * it, the eyes, the face. What distinguishes them is which arms are raised,
 * where the pupils sit, which mouth is drawn — and the **prop**. Otto is
 * almost never empty-handed: he holds a coin while thinking, juggles one while
 * loading, taps a cube while simulating, presents a receipt when a plan is
 * ready. A pose without its prop is not the pose.
 *
 * Props are JSX rather than data because they are arbitrary art — rectangles,
 * arcs, a cloud — and a schema wide enough to describe them would just be SVG
 * with extra steps.
 *
 * Prop colours are the design's literals, not tokens. They stay the same in
 * dark mode there, and a coin that changes hue with the theme stops reading as
 * a coin.
 */

const INK = '#16213E'
const CREAM = '#FFF0DC'
const PLAN = '#2E7CF6'
const WARN = '#F5A524'
const OK = '#1FB57A'
const CLOUD = '#33456E'

export interface Pose {
  /** Seven back arms, drawn behind the body. */
  arms: string[]
  /** The one arm drawn in front, slightly thinner. */
  frontArm: string
  /** Suckers on the front arm. Absent when the pose hides its underside. */
  suckers?: boolean
  /** Suckers on a raised arm — the one reaching for something. */
  armSuckers?: [number, number][]
  /** Indices of arms that catch on the juggle beat rather than swaying. */
  catchArms?: number[]
  /** Index of the arm that taps, and the suckers that ride with it. */
  tapArm?: number
  /** [x, y, r] per pupil. The whites stay put; the gaze moves. */
  pupils?: [number, number, number][]
  /** Highlight dots, omitted where the pose wants a flatter eye. */
  glints?: [number, number][]
  /** Eye radius. Ink opens them wider; celebrating draws none at all. */
  eyeR?: number
  /** Left brow, right brow, mouth. Drawn as one navy stroke group. */
  face: string[]
  /** Stroke width for the face group. Celebrating uses a heavier line. */
  faceWidth?: number
  /** Filled mouth parts — a tongue, or ink's open oval. */
  mouth?: (shade: string) => ReactNode
  /** Drawn behind every arm: the ink cloud, the simulating glow. */
  behind?: (animated: boolean) => ReactNode
  /** Drawn over everything: what Otto is holding. */
  prop?: (animated: boolean) => ReactNode
}

const BACK_ARMS_DEFAULT = [
  'M50 126 C26 138 14 154 20 172',
  'M72 140 C58 158 56 176 66 184',
  'M96 144 C92 164 100 180 116 184',
  'M122 142 C136 160 150 172 166 172',
  'M144 130 C164 142 176 158 172 176',
  'M154 110 C184 100 196 72 186 48',
  'M44 112 C22 110 8 122 8 142',
]

/** Same five lower arms, differing only in the two raised ones. */
const withRaised = (sixth: string, seventh = BACK_ARMS_DEFAULT[6]!) => [
  ...BACK_ARMS_DEFAULT.slice(0, 5),
  sixth,
  seventh,
]

/** The reaching arms shared by thinking and the juggling loader. */
const REACH_BOTH = withRaised(
  'M150 106 C172 92 176 66 160 52',
  'M48 108 C26 96 20 70 38 54',
)

/** The arm that taps the cube, shared by tasting and tapping. */
const TAP_ARM = 'M152 108 C172 104 180 92 178 78'
const TAP_SUCKERS: [number, number][] = [
  [163, 103],
  [173, 96],
  [178, 85],
]

const BROWS_BASE = ['M66 52 Q79 44 91 51', 'M109 51 Q121 44 134 52']
const BROWS_THINKING = ['M66 49 Q79 41 91 48', 'M109 48 Q121 41 134 49']
const BROWS_TASTING = ['M64 68 Q79 62 93 67', 'M107 67 Q121 62 136 68']

/** The coin Otto turns over while he thinks. */
const coin = (animated: boolean) => (
  <g className={animated ? 'otto-juggle-a' : undefined}>
    <circle cx="164" cy="31" r="13" fill={PLAN} stroke={INK} strokeWidth={5} />
    <path d="M158 31 h12" stroke={INK} strokeWidth={4} strokeLinecap="round" />
  </g>
)

/** Two links — the route he is weighing the coin against. */
const chain = (animated: boolean) => (
  <g
    className={animated ? 'otto-juggle-b' : undefined}
    fill="none"
    stroke={INK}
    strokeWidth={4.5}
  >
    <circle cx="28" cy="35" r="9" />
    <circle cx="43" cy="26" r="9" />
  </g>
)

/** The cube he taps while a simulation runs. */
const cube = (animated: boolean) => (
  <g transform="rotate(12 188 60)" className={animated ? 'otto-cube' : undefined}>
    <rect x="170" y="42" width="36" height="36" rx="8" fill={PLAN} stroke={INK} strokeWidth={5} />
    <path d="M180 60 h16" stroke="#fff" strokeWidth={4} strokeLinecap="round" opacity={0.8} />
  </g>
)

const glow = (animated: boolean) => (
  <circle
    cx="188"
    cy="60"
    r="30"
    fill={PLAN}
    opacity={animated ? undefined : 0.16}
    className={animated ? 'otto-glow' : undefined}
  />
)

const POSES_RAW = {
  /** Nothing in his hands and nothing to say. The one empty pose. */
  base: {
    arms: BACK_ARMS_DEFAULT,
    frontArm: 'M62 128 C50 144 60 162 82 160',
    suckers: true,
    pupils: [
      [82, 78, 8.5],
      [124, 78, 8.5],
    ],
    glints: [
      [78.5, 73.5],
      [120.5, 73.5],
    ],
    face: [...BROWS_BASE, 'M91 101 Q100 110 109 101'],
  },

  /** Working out a route: a coin in one arm, a chain in the other. */
  planning: {
    arms: REACH_BOTH,
    frontArm: 'M64 130 C54 148 66 164 88 160',
    suckers: true,
    pupils: [
      [81, 70, 8.5],
      [123, 70, 8.5],
    ],
    glints: [
      [77.5, 66.5],
      [119.5, 66.5],
    ],
    face: [...BROWS_THINKING, 'M92 103 Q100 110 108 103'],
    prop: () => (
      <>
        {coin(false)}
        {chain(false)}
      </>
    ),
  },

  /** The same two props, in the air. This is the juggling loader. */
  loader: {
    arms: REACH_BOTH,
    frontArm: 'M62 128 C50 144 60 162 82 160',
    suckers: true,
    catchArms: [5, 6],
    pupils: [
      [81, 70, 8.5],
      [123, 70, 8.5],
    ],
    glints: [
      [77.5, 66.5],
      [119.5, 66.5],
    ],
    face: [...BROWS_THINKING, 'M92 103 Q100 110 108 103'],
    prop: (animated: boolean) => (
      <>
        {coin(animated)}
        {chain(animated)}
      </>
    ),
  },

  /** Holding out the receipt. */
  'plan-ready': {
    arms: withRaised('M154 112 C182 106 192 86 182 66'),
    frontArm: 'M62 128 C50 144 60 162 82 160',
    suckers: true,
    pupils: [
      [82, 77, 8.5],
      [124, 77, 8.5],
    ],
    glints: [
      [78.5, 72.5],
      [120.5, 72.5],
    ],
    face: [...BROWS_BASE, 'M88 99 Q100 112 112 99'],
    prop: () => (
      <g transform="rotate(-8 176 44)">
        <rect x="158" y="12" width="52" height="40" rx="7" fill="#fff" stroke={INK} strokeWidth={5} />
        <g stroke={INK} strokeWidth={4} strokeLinecap="round">
          <path d="M168 24 h22" />
          <path d="M168 33 h32" />
        </g>
        <path d="M168 42 h12" stroke={OK} strokeWidth={4} strokeLinecap="round" />
      </g>
    ),
  },

  /** Tasting the fork. Tongue out, a cube in reach, the glow behind it. */
  simulating: {
    arms: withRaised(TAP_ARM),
    frontArm: 'M60 130 C46 146 56 164 78 162',
    suckers: true,
    armSuckers: TAP_SUCKERS,
    pupils: [
      [83, 82, 8],
      [125, 82, 8],
    ],
    face: [...BROWS_TASTING, 'M91 101 Q100 107 109 101'],
    mouth: (shade: string) => (
      <path
        d="M99 106 C99 114 108 115 108 106 Z"
        fill={shade}
        stroke={INK}
        strokeWidth={4}
        strokeLinejoin="round"
      />
    ),
    behind: glow,
    prop: () => cube(false),
  },

  /** The same, tapping. Three taps, a rest, and the cube answers. */
  tapping: {
    arms: withRaised(TAP_ARM),
    frontArm: 'M62 128 C50 144 60 162 82 160',
    suckers: true,
    armSuckers: TAP_SUCKERS,
    tapArm: 5,
    pupils: [
      [83, 82, 8],
      [125, 82, 8],
    ],
    face: [...BROWS_TASTING, 'M91 101 Q100 107 109 101'],
    mouth: (shade: string) => (
      <path
        d="M99 106 C99 114 108 115 108 106 Z"
        fill={shade}
        stroke={INK}
        strokeWidth={4}
        strokeLinejoin="round"
      />
    ),
    behind: glow,
    prop: (animated: boolean) => cube(animated),
  },

  /** One arm up, and the amber triangle it is pointing at. */
  'heads-up': {
    arms: withRaised('M154 108 C174 102 188 86 198 68'),
    frontArm: 'M62 130 C50 146 62 164 84 161',
    suckers: true,
    pupils: [
      [84, 77, 8.5],
      [126, 77, 8.5],
    ],
    glints: [
      [80.5, 72.5],
      [122.5, 72.5],
    ],
    face: ['M66 48 Q78 46 91 55', 'M109 55 Q122 46 134 48', 'M92 104 Q100 100 108 104'],
    prop: () => (
      <>
        <path
          d="M200 22 L220 58 L180 58 Z"
          fill={WARN}
          stroke={INK}
          strokeWidth={5}
          strokeLinejoin="round"
        />
        <path d="M200 35 v10" stroke={INK} strokeWidth={4.5} strokeLinecap="round" />
        <circle cx="200" cy="52" r="2.6" fill={INK} />
      </>
    ),
  },

  /** Blocked. The cloud is the pose — he is inside it, not beside it. */
  ink: {
    arms: [
      'M56 128 C32 140 20 150 14 164',
      'M80 138 C70 160 70 176 82 182',
      'M104 142 C108 164 118 176 132 178',
      'M128 136 C144 152 158 160 172 156',
      'M150 122 C170 132 182 144 184 160',
      'M152 104 C178 94 190 70 182 48',
      'M42 110 C18 108 4 122 10 144',
    ],
    frontArm: 'M64 132 C56 152 72 166 92 160',
    eyeR: 18,
    pupils: [
      [80, 77, 6],
      [122, 77, 6],
    ],
    face: ['M63 48 Q78 42 92 48', 'M108 48 Q122 42 137 48'],
    mouth: () => <ellipse cx="100" cy="105" rx="7" ry="8" fill={INK} />,
    behind: () => (
      <path
        d="M100 2 C62 -8 24 16 22 52 C-6 70 -4 120 22 138 C28 176 76 198 108 184 C142 198 184 172 180 140 C206 118 202 74 178 56 C174 20 134 -8 100 2 Z"
        fill={CLOUD}
        opacity={0.94}
      />
    ),
  },

  /** Signed. Eyes closed happy, and two green arcs cheering at the edges. */
  confirmed: {
    arms: [
      'M56 128 C32 140 20 154 26 172',
      'M80 138 C70 158 74 176 90 180',
      'M104 142 C112 162 126 172 140 170',
      'M128 136 C146 148 158 164 154 180',
      'M148 124 C168 132 180 148 178 166',
      'M152 104 C178 92 190 66 178 44',
      'M46 104 C20 92 10 66 24 46',
    ],
    frontArm: 'M62 130 C46 142 44 160 58 172',
    face: ['M66 80 Q79 66 92 80', 'M108 80 Q121 66 134 80', 'M87 100 Q100 114 113 100'],
    faceWidth: 6,
    behind: () => (
      <g fill="none" stroke={OK} strokeWidth={7} strokeLinecap="round" opacity={0.55}>
        <path d="M6 52 Q-8 96 6 140" />
        <path d="M194 52 Q208 96 194 140" />
      </g>
    ),
  },
} satisfies Record<string, Pose>

export type PoseName = keyof typeof POSES_RAW

export const POSES: Record<PoseName, Pose> = POSES_RAW

export const POSE_NAMES = Object.keys(POSES) as PoseName[]

/** The design's per-arm sway offsets, in order. Not a uniform stagger. */
export const SWAY_DELAYS = [0, -0.35, -0.7, -1.05, -1.4, -1.2, -2.1]

/** The front arm swings with the fourth. */
export const FRONT_ARM_DELAY = -1.05

/** Arms rotate about the joint they leave the body at, which is where they start. */
export function armOrigin(d: string): [number, number] {
  const m = /^M([\d.]+)[ ,]([\d.]+)/.exec(d)
  return m ? [Number(m[1]), Number(m[2])] : [100, 130]
}

export { CREAM, INK }
