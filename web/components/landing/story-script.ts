import type { PoseName } from '@/components/brand'

/**
 * The landing page's scroll story, as numbers. One pinned section is scrubbed
 * from 0 to 1 by scroll; the copy on the left changes at each beat and the
 * stage on the right runs one continuous animation keyed to the same clock.
 *
 * Kept apart from the components so the timeline can be read, and tested,
 * without a browser: beats in order, every animation window inside the run.
 */

export interface Beat {
  id: 'clutter' | 'grouped' | 'sentence' | 'link' | 'checks' | 'endings'
  /** Where this beat's copy takes over. */
  from: number
  /** A progress at which the stage shows this beat finished — for stills. */
  still: number
  n: string
  title: string
  body: string
  /** Otto's pose while this beat is on screen. */
  pose: PoseName
}

export const BEATS: readonly Beat[] = [
  {
    id: 'clutter',
    from: 0,
    still: 0.04,
    n: '01 · Today',
    title: 'Five tabs. Three wallets. Ten clicks.',
    body: 'That is what one stock costs you today.',
    pose: 'heads-up',
  },
  {
    id: 'grouped',
    from: 0.14,
    still: 0.23,
    n: '01 · With Otto',
    title: 'Otto holds them all.',
    body: 'Every wallet in one place. Every tab gone.',
    pose: 'planning',
  },
  {
    id: 'sentence',
    from: 0.26,
    still: 0.41,
    n: '02',
    title: 'Say it once.',
    body: 'To Claude, Codex or any MCP agent. Nothing to install.',
    pose: 'simulating',
  },
  {
    id: 'link',
    from: 0.44,
    still: 0.63,
    n: '03',
    title: 'One link back.',
    body: 'Not ten pop-ups. One page that explains itself.',
    pose: 'plan-ready',
  },
  {
    id: 'checks',
    from: 0.64,
    still: 0.82,
    n: '04 · Safety',
    title: 'Checked before you sign.',
    body: 'Decoded, simulated and warned — in plain words.',
    pose: 'heads-up',
  },
  {
    id: 'endings',
    from: 0.84,
    still: 1,
    n: '05',
    title: 'You sign. Or your agent does.',
    body: 'Agent wallets act only inside a rule you set.',
    pose: 'confirmed',
  },
]

/** The beat on screen at a given progress. */
export function beatAt(progress: number): number {
  let i = 0
  for (let k = 0; k < BEATS.length; k++) if (progress >= BEATS[k]!.from) i = k
  return i
}

/**
 * Animation windows on the stage, as [start, end] of scroll progress.
 * Scene one is the clutter flying into Otto; three is the link growing into
 * the review; four splits the review into its checks; five is the endings.
 */
const span = (start: number, end: number): [number, number] => [start, end]
const four = (a: number, b: number, c: number, d: number): [number, number, number, number] => [a, b, c, d]

export const T = {
  gather: span(0.06, 0.2),
  ottoIn: span(0.08, 0.16),
  stack: span(0.12, 0.22),
  sceneOneOut: span(0.24, 0.28),
  chatIn: span(0.27, 0.32),
  tools: four(0.31, 0.34, 0.37, 0.4),
  reply: span(0.43, 0.47),
  glow: span(0.47, 0.51),
  morph: span(0.52, 0.62),
  split: span(0.65, 0.72),
  lights: four(0.7, 0.73, 0.76, 0.79),
  endingsIn: span(0.84, 0.92),
}

/** The one example the whole page follows, so every figure agrees. */
export const EXAMPLE = {
  pay: '50 USDT',
  get: '0.2757 NVDAB',
  minGet: '0.2743',
  reference: '$181.20',
  perShare: '$181.35',
  premium: '+0.08%',
  holds: '412 USDT',
  agentPay: '20 USDT',
} as const
