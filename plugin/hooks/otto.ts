import type { Kind } from './card'

/**
 * Otto, small enough to sit beside the card: the round face from the badge,
 * eight pixels by eight, two to a cell, so four columns' worth of text is all
 * he costs. A coral disc, a cream chin, navy pupils, and no ring around him.
 */
export const OTTO_COLUMNS = 8
export const OTTO_ROWS = 4

/** How often a live card asks for his next frame. */
export const OTTO_MS = 200

const INK: Record<string, number> = { c: 0xf58a6a, d: 0xe06a47, w: 0xffffff, n: 0x16213e, m: 0xfff0dc }
/** The terminal's own background: where he is not. */
const CLEAR = 0x01000000

const BROW = ['..cccc..', '.cccccc.', 'cccccccc']
const EYES = {
  open: 'cwnccwnc',
  shut: 'cddccddc',
  // Looking the other way, after a plan on its way.
  away: 'cnwccnwc',
}
const CHIN = ['cccccccc', 'cccccccc', '.mmmmmm.', '..mmmm..']
/**
 * Where the cream meets the coral, a column at a time, in eighths of a cell:
 * the badge's wave, two crests and two troughs, finer than a pixel can say.
 */
const WAVE = [3, 4, 1, 0, 2, 4, 1, 1]
/** The cream turned up at the corners: a plan went through. */
const SMILE = [5, 6, 3, 1, 1, 3, 6, 5]
/** The row of cells the wave is drawn in: the one under his eyes. */
const WAVE_ROW = 2

export type Pose = 'idle' | 'busy' | 'happy' | 'spent'

/** What he does for each kind of card: blinks while a plan waits, looks after a sent one, smiles at a confirmed one, shuts his eyes otherwise. */
export function poseOf(kind: Kind): Pose {
  if (kind === 'ready') return 'idle'
  if (kind === 'submitted') return 'busy'
  return kind === 'confirmed' ? 'happy' : 'spent'
}

/** True for the pose that moves, and so needs a timer. */
export function isMoving(pose: Pose): boolean {
  return pose === 'idle'
}

const BLINK_EVERY_MS = 4000
const BLINK_MS = 200

/** How high the cream stands in each column under his eyes, in eighths of a cell. */
export function ottoWave(pose: Pose): number[] {
  return pose === 'happy' ? SMILE : WAVE
}

/** His eight rows of pixels at a moment, the wave aside. A still pose is the same at every moment. */
export function ottoPixels(pose: Pose, now: number): string[] {
  if (pose === 'happy') return [...BROW, EYES.open, ...CHIN]
  if (pose === 'spent') return [...BROW, EYES.shut, ...CHIN]
  if (pose === 'busy') return [...BROW, EYES.away, ...CHIN]
  return [...BROW, now % BLINK_EVERY_MS < BLINK_MS ? EYES.shut : EYES.open, ...CHIN]
}

const dim = (color: number): number => ((color >> 1) & 0x7f7f7f) + 0x202020

/**
 * A frame as a Raster takes it: each cell an upper half block, its foreground
 * the pixel above and its background the one below. The wave is the one row
 * drawn finer: cream rising from the foot of a coral cell. A spent Otto is drawn dim.
 */
export function ottoCells(pose: Pose, now: number): string {
  const pixels = ottoPixels(pose, now)
  const shade = (color: number | undefined): number => (color === undefined ? CLEAR : pose === 'spent' ? dim(color) : color)
  const ink = (row: number, column: number): number => shade(INK[pixels[row]![column]!])
  const wave = ottoWave(pose)
  const words = new Uint32Array(OTTO_COLUMNS * OTTO_ROWS * 3)
  for (let row = 0; row < OTTO_ROWS; row += 1) {
    for (let column = 0; column < OTTO_COLUMNS; column += 1) {
      const above = ink(row * 2, column)
      const below = ink(row * 2 + 1, column)
      // With nothing above, the lower half block draws the pixel below on a clear cell.
      const height = row === WAVE_ROW ? wave[column]! : 0
      // U+2581 to U+2588 are the lower eighths, one to eight.
      const cell = height > 0 ? [0x2580 + height, shade(INK.m), above] : above === CLEAR ? (below === CLEAR ? [0x20, CLEAR, CLEAR] : [0x2584, below, CLEAR]) : [0x2580, above, below]
      words.set(cell, (row * OTTO_COLUMNS + column) * 3)
    }
  }
  // The engine's runtime has toBase64; the TypeScript lib in use does not declare it yet.
  return (new Uint8Array(words.buffer) as Uint8Array & { toBase64(): string }).toBase64()
}
