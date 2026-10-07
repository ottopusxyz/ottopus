import { describe, expect, it } from 'vitest'
import { type RuleInput, evaluateRule } from './rules.js'

/** Everything in its favour; each test takes one thing away. */
const qualifies: RuleInput = { autoExecute: true, agentExecutes: true, verified: true, simulation: { success: true } }

describe('the auto-execute rule', () => {
  it('approves a verified, simulated plan on an agent arm whose switch is on', () => {
    expect(evaluateRule(qualifies)).toEqual({ approve: true, reason: expect.stringContaining('simulation passed') })
  })

  it('never approves with the switch off', () => {
    expect(evaluateRule({ ...qualifies, autoExecute: false })).toMatchObject({ approve: false, reason: 'the arm has no rule' })
  })

  it('never approves for an arm a person signs with, whatever the switch says', () => {
    expect(evaluateRule({ ...qualifies, agentExecutes: false })).toMatchObject({ approve: false })
  })

  it('never approves a plan that did not verify', () => {
    expect(evaluateRule({ ...qualifies, verified: false })).toMatchObject({ approve: false })
  })

  it('no simulation, no auto', () => {
    expect(evaluateRule({ ...qualifies, simulation: null })).toMatchObject({
      approve: false,
      reason: expect.stringContaining('no simulation ran'),
    })
  })

  it('never approves on a failed simulation', () => {
    expect(evaluateRule({ ...qualifies, simulation: { success: false } })).toMatchObject({
      approve: false,
      reason: 'the simulation failed',
    })
  })
})
