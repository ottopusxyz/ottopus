import { describe, expect, it } from 'vitest'
import { POSE_NAMES } from '@/components/brand'
import { BEATS, T, beatAt } from './story-script'

describe('the scroll story', () => {
  it('starts at the top and runs its beats in order', () => {
    expect(BEATS[0]!.from).toBe(0)
    for (let i = 1; i < BEATS.length; i++) expect(BEATS[i]!.from).toBeGreaterThan(BEATS[i - 1]!.from)
  })

  it('draws each still inside its own beat', () => {
    BEATS.forEach((b, i) => {
      expect(beatAt(b.still)).toBe(i)
    })
  })

  it('keeps every animation window inside the run, start before end', () => {
    for (const range of Object.values(T)) {
      for (let i = 1; i < range.length; i++) expect(range[i]).toBeGreaterThan(range[i - 1]!)
      expect(range[0]).toBeGreaterThanOrEqual(0)
      expect(range.at(-1)).toBeLessThanOrEqual(1)
    }
  })

  it('finishes the link-to-review morph before the review splits into checks', () => {
    expect(T.morph[1]).toBeLessThan(T.split[0])
    expect(T.lights.at(-1)).toBeLessThan(T.endingsIn[0])
  })

  it('draws Otto only in poses that exist', () => {
    for (const b of BEATS) expect(POSE_NAMES).toContain(b.pose)
  })
})
