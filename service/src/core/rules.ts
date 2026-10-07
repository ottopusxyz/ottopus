import type { Simulation } from './plan.js'

/**
 * The person's standing rule for an arm, decided at prepare time.
 *
 * One switch per agentic arm today: on, and a plan the arm will execute is
 * approved without review when verification and an independent simulation
 * both pass. The rule never approves a plan a person signs with, because
 * there is nobody to hand the calls to; and it never approves without a
 * simulation that ran and passed, because the decoder reads intent and only
 * a run reads outcome. A custom plan — calls an agent wrote — is not this
 * rule's to approve, whatever the switch says.
 *
 * Pure, so the whole table can be tested without a database or a chain. The
 * store checks the arm again when it writes the approval; this only says
 * whether the plan in hand would qualify.
 */
export interface RuleInput {
  /** The arm's switch. */
  autoExecute: boolean
  /** An agent's own wallet sends this arm's plans. */
  agentExecutes: boolean
  /** The verify policy passed. */
  verified: boolean
  /** What ran at prepare, or null when nothing did. */
  simulation: Pick<Simulation, 'success'> | null
}

export type RuleVerdict = { approve: true; reason: string } | { approve: false; reason: string }

export function evaluateRule(input: RuleInput): RuleVerdict {
  if (!input.autoExecute) return { approve: false, reason: 'the arm has no rule' }
  if (!input.agentExecutes) return { approve: false, reason: 'the arm is one a person signs with, not one an agent executes' }
  if (!input.verified) return { approve: false, reason: 'the plan did not pass verification' }
  if (!input.simulation) return { approve: false, reason: 'no simulation ran, and the rule needs one' }
  if (!input.simulation.success) return { approve: false, reason: 'the simulation failed' }
  return { approve: true, reason: 'the plan verified and the simulation passed' }
}
