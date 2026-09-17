/**
 * Otto's poses, transcribed from Otto.dc.html in the design project. The art is
 * authoritative — these paths are copied, never redrawn.
 *
 * Every pose is built the same way: seven back arms, then the body, then one
 * front arm that overlaps it. Each arm is stroked twice — a wide navy edge and
 * a narrower body-coloured core — which is what gives the outlined look. The
 * renderer rebuilds that, so no pose repeats the structure here.
 *
 * The design project names poses by mood; the product names them by state. The
 * aliases below are the product's names, which is what code should use.
 */

export interface Pose {
  /** Seven back arms, drawn behind the body. */
  arms: string[]
  /** The one arm drawn in front, slightly thinner. */
  frontArm: string
  /** Suckers on the front arm. Absent when the pose hides its underside. */
  suckers?: boolean
  /** [x, y, r] per pupil. The whites stay put; the gaze moves. */
  pupils?: [number, number, number][]
  /** Highlight dots, omitted where the pose wants a flatter eye. */
  glints?: [number, number][]
  /** Left brow, right brow, mouth. Drawn as one navy stroke group. */
  face: string[]
  /** Stroke width for the face group. Celebrating uses a heavier line. */
  faceWidth?: number
  /** Eye radius. Ink opens them wider. */
  eyeR?: number
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
const withRaised = (sixth: string, seventh: string) => [
  ...BACK_ARMS_DEFAULT.slice(0, 5),
  sixth,
  seventh,
]

const POSES_RAW = {
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
    face: ['M66 52 Q79 44 91 51', 'M109 51 Q121 44 134 52', 'M91 101 Q100 110 109 101'],
  },

  planning: {
    arms: withRaised('M150 106 C172 92 176 66 160 52', 'M48 108 C26 96 20 70 38 54'),
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
    face: ['M66 49 Q79 41 91 48', 'M109 48 Q121 41 134 49', 'M92 103 Q100 110 108 103'],
  },

  'plan-ready': {
    arms: withRaised('M154 112 C182 106 192 86 182 66', BACK_ARMS_DEFAULT[6]!),
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
    face: ['M66 52 Q79 44 91 51', 'M109 51 Q121 44 134 52', 'M88 99 Q100 112 112 99'],
  },

  simulating: {
    arms: withRaised('M152 108 C172 104 180 92 178 78', BACK_ARMS_DEFAULT[6]!),
    frontArm: 'M60 130 C46 146 56 164 78 162',
    suckers: true,
    pupils: [
      [83, 82, 8],
      [125, 82, 8],
    ],
    face: ['M64 68 Q79 62 93 67', 'M107 67 Q121 62 136 68', 'M91 101 Q100 107 109 101'],
  },

  'heads-up': {
    arms: withRaised('M154 108 C174 102 188 86 198 68', BACK_ARMS_DEFAULT[6]!),
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
  },

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
  },

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
    faceWidth: 6,
    // Eyes closed and smiling: the whole face is the stroke group.
    face: ['M66 80 Q79 66 92 80', 'M108 80 Q121 66 134 80', 'M87 100 Q100 114 113 100'],
  },
} satisfies Record<string, Pose>

export type PoseName = keyof typeof POSES_RAW

/**
 * `satisfies` validates each pose but narrows to its literal shape, so an
 * optional field missing from one pose becomes inaccessible on all of them.
 * This view keeps the literal key names while giving every pose the same type.
 */
export const POSES: Record<PoseName, Pose> = POSES_RAW

export const POSE_NAMES = Object.keys(POSES) as PoseName[]
