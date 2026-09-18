import { createHash } from 'node:crypto'
import {
  type DecodedAction,
  type Plan,
  type PlanDraft,
  type Simulation,
  planDraftSchema,
  planSchema,
} from './plan.js'

/**
 * planHash. The one value display, simulation and execution all bind to.
 *
 * Computed here and nowhere else — Next renders what the service returns and
 * never recomputes or verifies a hash, so one implementation means there is
 * nothing to drift.
 */

/** Bumped only if the canonical form changes. Part of the hashed payload. */
export const HASH_VERSION = 1

export class PlanIntegrityError extends Error {}

/**
 * Canonical JSON: keys sorted at every level, `undefined` dropped, integers
 * only. Two plans that mean the same thing hash the same regardless of the
 * order their fields were assembled in, and a float can never sneak into a
 * hash where "0.1" and 0.1 would be two different plans.
 */
export function canonicalize(value: unknown): string {
  if (value === null) return 'null'
  switch (typeof value) {
    case 'string':
      return JSON.stringify(value)
    case 'boolean':
      return value ? 'true' : 'false'
    case 'number':
      if (!Number.isSafeInteger(value)) {
        throw new PlanIntegrityError(`cannot hash a non-integer number: ${value}`)
      }
      return String(value)
    case 'bigint':
      return value.toString()
    case 'object': {
      if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`
      const entries = Object.entries(value as Record<string, unknown>)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([k, v]) => `${JSON.stringify(k)}:${canonicalize(v)}`)
      return `{${entries.join(',')}}`
    }
    default:
      throw new PlanIntegrityError(`cannot hash a ${typeof value}`)
  }
}

export function sha256Hex(input: string): string {
  return createHash('sha256').update(input).digest('hex')
}

/**
 * What the hash covers: everything the draft holds except its status.
 *
 * That is more than the minimum — user, account, chain, calls, quote expiry,
 * version and constraints would do — and deliberately so. The human plan is
 * what the person reads; a hash that let the summary change under a fixed set
 * of calls would bind the page to the transaction but not to what it claims to
 * be. Status is excluded because it lives in events and changes by design.
 * Decoded actions and simulation are excluded because they are evidence about
 * the calls, derived from them and re-runnable, not the thing itself.
 */
export function hashedPayload(plan: PlanDraft | Plan) {
  return {
    hashVersion: HASH_VERSION,
    id: plan.id,
    version: plan.version,
    userId: plan.userId,
    createdVia: plan.createdVia,
    intent: plan.intent,
    provenance: plan.provenance,
    resolution: plan.resolution,
    outcome: plan.outcome,
    quote: plan.quote,
    humanPlan: plan.humanPlan,
    expiresAt: plan.expiresAt,
  }
}

export function planHashOf(plan: PlanDraft | Plan): string {
  return sha256Hex(canonicalize(hashedPayload(plan)))
}

/** The evidence a draft is assembled with. Both optional until #18 and #23. */
export interface Evidence {
  decodedActions?: DecodedAction[]
  simulation?: Simulation | null
}

/**
 * A draft becomes a plan: hashed, with its evidence attached.
 *
 * The draft is parsed before it is hashed, not after. Parsing normalises —
 * calldata is lowercased, for one — and a hash taken over the raw input would
 * not match the normalised plan that comes out the other side, so parsePlan
 * would reject the very plan this function just built. Hash what will be
 * stored, never what was handed in.
 */
export function assemblePlan(draft: PlanDraft, evidence: Evidence = {}): Plan {
  const normalised = planDraftSchema.parse(draft)
  return planSchema.parse({
    ...normalised,
    planHash: planHashOf(normalised),
    decodedActions: evidence.decodedActions ?? [],
    simulation: evidence.simulation ?? null,
  })
}

/**
 * Parse something that claims to be a plan, and prove it. Anything read back
 * from storage or off the wire comes through here; a plan whose hash does not
 * match its contents is not a plan, whatever the row says.
 */
export function parsePlan(input: unknown): Plan {
  const plan = planSchema.parse(input)
  const expected = planHashOf(plan)
  if (plan.planHash !== expected) {
    throw new PlanIntegrityError(`planHash mismatch: stored ${plan.planHash}, computed ${expected}`)
  }
  return plan
}
