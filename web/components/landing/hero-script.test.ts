import { describe, expect, it } from 'vitest'
import { POSE_NAMES } from '@/components/brand'
import { BEATS, BEAT_MS, BEAT_POSE, HERO_RUNS, poseFor } from './hero-script'

describe('the hero demo script', () => {
  it('ends every run on the review, where the person decides', () => {
    expect(BEATS.at(-1)).toBe('review')
    expect(BEAT_MS.review).toBeGreaterThan(Math.max(...BEATS.slice(0, -1).map((b) => BEAT_MS[b])))
  })

  it('draws Otto only in poses that exist', () => {
    for (const beat of BEATS) expect(POSE_NAMES).toContain(BEAT_POSE[beat])
  })

  it('shows both endings: a person signs, and a rule approves for an agent wallet', () => {
    expect(HERO_RUNS.map((r) => r.finish)).toEqual(['sign', 'rule'])
    expect(HERO_RUNS.find((r) => r.finish === 'rule')!.wallet.type).toBe('agentic')
  })

  it('never has an agent wallet end on a signature, or a signer end on a rule', () => {
    for (const run of HERO_RUNS) {
      expect(run.finish === 'rule').toBe(run.wallet.type === 'agentic')
      expect(poseFor(run, 'review')).toBe(run.finish === 'rule' ? 'confirmed' : 'plan-ready')
    }
  })

  it('picks exactly one stock token, and one with market data', () => {
    for (const run of HERO_RUNS) {
      const picked = run.stocks.filter((s) => s.picked)
      expect(picked).toHaveLength(1)
      expect(picked[0]!.premium).not.toBeNull()
    }
  })
})
