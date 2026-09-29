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
  id: 'clutter' | 'grouped' | 'sentence' | 'picks' | 'link' | 'checks' | 'endings'
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
    still: 0.03,
    n: '01 · Today',
    title: 'Buying one stock onchain shouldn’t take six tabs.',
    body: 'Too many wallets. Too many dApps. Which one?',
    pose: 'heads-up',
  },
  {
    id: 'grouped',
    from: 0.11,
    still: 0.19,
    n: '01 · With Otto',
    title: 'Otto holds them all.',
    body: 'Every wallet in one place. Every tab gone.',
    pose: 'planning',
  },
  {
    id: 'sentence',
    from: 0.21,
    still: 0.33,
    n: '02',
    title: 'Just tell your agent.',
    body: 'One sentence in, one signature out. Claude, Codex or any MCP agent.',
    pose: 'simulating',
  },
  {
    id: 'picks',
    from: 0.35,
    still: 0.45,
    n: '02 · The wallet',
    title: 'Otto picks the wallet, and says why.',
    body: 'Six wallets checked. The one with the BNB and the gas wins.',
    pose: 'planning',
  },
  {
    id: 'link',
    from: 0.48,
    still: 0.63,
    n: '03',
    title: 'One link back.',
    body: 'Not ten pop-ups. One page that explains itself.',
    pose: 'plan-ready',
  },
  {
    id: 'checks',
    from: 0.64,
    still: 0.775,
    n: '04 · Safety',
    title: 'Checked before you sign.',
    body: 'Decoded, simulated and warned — in plain words.',
    pose: 'heads-up',
  },
  {
    id: 'endings',
    from: 0.78,
    still: 1,
    n: '05',
    title: 'You sign. Or your agent does.',
    body: 'Agent wallets act only inside a rule you set.',
    pose: 'plan-ready',
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
 * Mutable tuples on purpose: Motion's input ranges will not take readonly ones.
 */
const span = (start: number, end: number): [number, number] => [start, end]
const four = (a: number, b: number, c: number, d: number): [number, number, number, number] => [a, b, c, d]

export const T = {
  /** 01 — the tabs, wallets and dApps fly into Otto. */
  gather: span(0.04, 0.14),
  stack: span(0.1, 0.18),
  sceneOneOut: span(0.2, 0.23),
  /** 02 — the chat rises and the tool calls tick in. */
  chatIn: span(0.22, 0.26),
  tools: four(0.26, 0.28, 0.3, 0.32),
  /** 02 · the wallet — six tiles, five dim, one wins with its reason. */
  pickIn: span(0.35, 0.38),
  pick: span(0.39, 0.42),
  reason: span(0.42, 0.44),
  pickOut: span(0.46, 0.48),
  /** 03 — the reply, the link, and the link growing into the review. */
  reply: span(0.49, 0.52),
  glow: span(0.52, 0.55),
  morph: span(0.56, 0.62),
  /** 04 — the review splits into its checks, which light up in turn. */
  split: span(0.65, 0.69),
  lights: four(0.69, 0.715, 0.74, 0.765),
  /** 05 — the two endings. */
  endingsIn: span(0.79, 0.86),
}

/**
 * The one example the whole page follows, so every figure agrees: ten
 * dollars of Tesla, bought with BNB from a Binance Wallet, routed through
 * PancakeSwap by the Binance Trading API. The shape is the intro film's; the
 * figures are illustrative, not a quote, and the page never calls them real.
 */
export const EXAMPLE = {
  prompt: 'Buy me 10 USD worth of Tesla.',
  pay: '0.0131 BNB',
  payUsd: '$10.00',
  get: '0.0270 TSLAB',
  minGet: '0.0269',
  reference: '$369.66',
  perShare: '$370.37',
  premium: '+0.19%',
  route: 'PancakeSwap',
  via: 'via Binance Trading API',
  fee: '$0.03',
  holds: 'holds 0.015 BNB on BNB Chain, has gas',
  walletsChecked: 6,
} as const
