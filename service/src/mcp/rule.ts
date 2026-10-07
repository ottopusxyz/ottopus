import type { Simulator } from '../connectors/simulation/index.js'
import { type PlanStatus, type RuleVerdict, type Simulation, evaluateRule } from '../core/index.js'
import { capabilitiesOf } from '../wallets/agentic/index.js'
import type { Arm } from '../wallets/index.js'

/**
 * The auto-execute rule, as prepare_transfer and prepare_trade apply it.
 *
 * The rule is the one reason either tool simulates at prepare time: a plan
 * nobody will review has to be read by something other than a decoder before
 * it is approved. For every other arm the deployment's own choice stands,
 * and `simulator` is null in production because the review page runs its
 * own. The core decides; this file only gathers what it needs and words the
 * answer.
 */

/** The chosen arm and the two facts the rule reads off it. */
export interface ArmRule {
  arm: Arm
  autoExecute: boolean
  agentExecutes: boolean
}

export function armRule(arms: readonly Arm[], walletId: string): ArmRule | null {
  const arm = arms.find((a) => a.id === walletId)
  if (!arm) return null
  return { arm, autoExecute: arm.autoExecute, agentExecutes: capabilitiesOf(arm).agentExecutes }
}

/**
 * The simulator a prepare runs, if any: the deployment's, or the rule's
 * when the chosen arm is one the rule could approve. An arm with the switch
 * on that no agent executes gets neither — the rule will say why.
 */
export function simulatorFor(
  deps: { simulator: Simulator | null; ruleSimulator: Simulator | null },
  rule: ArmRule | null,
): Simulator | null {
  if (deps.simulator) return deps.simulator
  return rule?.autoExecute && rule.agentExecutes ? deps.ruleSimulator : null
}

/** What the tool reports beside a plan whose arm carries a rule. */
export interface RuleOutcome {
  /** The arm, as the outcome names it. */
  arm: string
  /** Whether the plan was approved under it. */
  applied: boolean
  reason: string
}

export function ruleVerdict(rule: ArmRule | null, verified: boolean, simulation: Simulation | null): RuleVerdict | null {
  if (!rule?.autoExecute) return null
  return evaluateRule({ autoExecute: rule.autoExecute, agentExecutes: rule.agentExecutes, verified, simulation })
}

/**
 * The verdict against what the store wrote. The store checks the arm again
 * under its transaction, so a rule switched off between the two reads
 * leaves a plan waiting for review that the verdict would have approved.
 */
export function ruleOutcome(verdict: RuleVerdict | null, armName: string, status: PlanStatus): RuleOutcome | null {
  if (!verdict) return null
  if (status === 'approved') return { arm: armName, applied: true, reason: verdict.reason }
  return {
    arm: armName,
    applied: false,
    reason: verdict.approve ? 'the rule was switched off before the plan was stored' : verdict.reason,
  }
}

/** The lines the agent reads when a rule approved the plan. */
export function approvedLines(rule: RuleOutcome, expiresAt: string, reviewUrl: string): string[] {
  return [
    `Approved by the rule for ${rule.arm}: ${rule.reason}. No review is needed.`,
    'Call get_plan to receive the calls, send them from the agent wallet, then report_execution with the transaction hash.',
    `The plan expires at ${expiresAt}. The person can still withdraw it until the calls are handed out: ${reviewUrl}`,
  ]
}

/** The line that says a rule exists and why it stood aside, or nothing. */
export function ruleLine(rule: RuleOutcome | null): string[] {
  return rule && !rule.applied ? [`The rule for ${rule.arm} did not apply: ${rule.reason}. This plan needs a review.`] : []
}
