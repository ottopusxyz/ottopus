import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { PLAN_STATUSES, PLAN_STATUS_LABELS } from './status-chip'

/**
 * The status vocabulary now exists in three places: here, the service's
 * core/plan.ts, and the database check constraint. The service already asserts
 * its own copy matches the database; this closes the loop so the UI cannot
 * render a status the rest of the system would refuse.
 */
describe('status vocabulary matches the service', () => {
  it('is identical to PLAN_STATUSES in the service', () => {
    const source = readFileSync(
      new URL('../../../service/src/core/plan.ts', import.meta.url),
      'utf8',
    )
    const block = /export const PLAN_STATUSES = \[([\s\S]*?)\] as const/.exec(source)
    expect(block, 'PLAN_STATUSES not found in the service').toBeTruthy()
    const inService = [...block![1]!.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]!)
    expect([...PLAN_STATUSES].sort()).toEqual(inService.sort())
  })

  it('has a label for every status, so none can render blank', () => {
    for (const status of PLAN_STATUSES) {
      expect(PLAN_STATUS_LABELS[status], `no label for ${status}`).toBeTruthy()
    }
  })

  it('says what happened rather than using mascot copy', () => {
    // "Inked" is what the illustration does; the chip has to be plain.
    expect(Object.values(PLAN_STATUS_LABELS)).not.toContain('Inked')
    expect(PLAN_STATUS_LABELS.cancelled).toBe('Cancelled')
  })
})
