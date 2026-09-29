import type { PoseName } from '@/components/brand'

/**
 * What the hero's demo plays: one sentence to an agent, and what Ottopus does
 * with it, beat by beat. Two runs that alternate, because there are two ways a
 * plan ends — a person signs it in their own wallet, or an agent wallet sends
 * it once a rule the person set has approved it.
 *
 * The figures are illustrative, shaped like the real tool output: find_stock
 * compares the issuers, the premium is over the share's reference price, and
 * xStocks carry no market data. They are not a quote and the page says so.
 */

export type Beat = 'prompt' | 'stock' | 'wallet' | 'checks' | 'review'

/** The order beats appear in. Every run shows all of them. */
export const BEATS: readonly Beat[] = ['prompt', 'stock', 'wallet', 'checks', 'review']

/** How long each beat holds before the next one lands, in ms. */
export const BEAT_MS: Readonly<Record<Beat, number>> = {
  prompt: 1500,
  stock: 1700,
  wallet: 1500,
  checks: 1600,
  review: 4200,
}

/** Otto's pose while a beat is the newest thing on the card. */
export const BEAT_POSE: Readonly<Record<Beat, PoseName>> = {
  prompt: 'base',
  stock: 'planning',
  wallet: 'planning',
  checks: 'simulating',
  review: 'plan-ready',
}

export interface StockRow {
  symbol: string
  issuer: 'bstock' | 'ondo' | 'xstocks'
  /** Over the share's reference, in percent; null when the issuer has no market data. */
  premium: number | null
  picked?: boolean
}

export interface HeroRun {
  key: 'sign' | 'rule'
  prompt: string
  stocks: readonly StockRow[]
  wallet: { type: string; name: string; reason: string }
  pay: string
  get: string
  /** How the plan ends: a review link to sign, or a rule that approved it. */
  finish: 'sign' | 'rule'
}

const NVIDIA: readonly StockRow[] = [
  { symbol: 'NVDAB', issuer: 'bstock', premium: 0.08, picked: true },
  { symbol: 'NVDAon', issuer: 'ondo', premium: 0.17 },
  { symbol: 'NVDAx', issuer: 'xstocks', premium: null },
]

export const HERO_RUNS: readonly HeroRun[] = [
  {
    key: 'sign',
    prompt: 'Put 200 USDT into NVIDIA',
    stocks: NVIDIA,
    wallet: { type: 'binance_wallet', name: 'Binance Wallet', reason: 'holds 412 USDT on BNB Chain' },
    pay: '200 USDT',
    get: '≈ 1.1028 NVDAB',
    finish: 'sign',
  },
  {
    key: 'rule',
    prompt: 'Now 20 USDT more from my agent wallet',
    stocks: NVIDIA,
    wallet: { type: 'agentic', name: 'Agent wallet', reason: 'inside its $50-a-plan rule' },
    pay: '20 USDT',
    get: '≈ 0.1103 NVDAB',
    finish: 'rule',
  },
]

/** Otto's pose for the newest beat on the card; a rule-approved plan is already done. */
export function poseFor(run: HeroRun, beat: Beat): PoseName {
  if (beat === 'review' && run.finish === 'rule') return 'confirmed'
  return BEAT_POSE[beat]
}
