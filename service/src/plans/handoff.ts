import { and, eq } from 'drizzle-orm'
import { type Call, PlanIntegrityError, type PlanStatus, parseAccountId } from '../core/index.js'
import { planEvents, plans } from '../db/schema.js'
import type { AgentProviderProfile } from '../wallets/agentic/index.js'
import { type PlanDb, PlanError, TX_HASH, executingArm, handedOffAt, latestEvent, toRecord } from './store.js'

/**
 * The one place a plan's calls leave the service for anything but the review
 * page, and the one writer of `approved -> submitted`.
 *
 * Both are the stated exception to "tool calls create plans, not
 * transactions", so both are as narrow as it is: the plan must be `approved`
 * and unexpired, and bound to an arm an agent operates. Everything is decided
 * under the plan's row lock, like every other transition.
 */

export interface PlanRef {
  userId: string
  planId: string
  version: number
}

export interface Handoff {
  planHash: string
  calls: Call[]
  /** The arm that sends them, 0x and lowercased. */
  address: string
  profile: AgentProviderProfile
  handedOffAt: string
  /** False when this read repeats an earlier release. */
  first: boolean
}

/**
 * The calls of an approved plan, for the agent whose wallet sends them, or
 * null — which is the answer for every other status, every other kind of arm
 * and a plan past its expiry.
 *
 * Released once: the first read writes a second `approved` event carrying
 * `handedOffAt`, and a later read finds it and repeats the same calls without
 * writing anything, so an agent that crashed mid-way recovers through the
 * path it came in by. The repeat stops when the plan stops being `approved`.
 */
export async function handOff(db: PlanDb, { userId, planId, version }: PlanRef, now = new Date()): Promise<Handoff | null> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(plans)
      .where(and(eq(plans.id, planId), eq(plans.version, version), eq(plans.userId, userId)))
      .for('update')
    if (!row) return null
    const latest = await latestEvent(tx, planId, version)
    if (!latest) throw new PlanIntegrityError(`plan ${planId} v${version} has no events`)

    // toRecord re-proves the hash and derives expiry: an approved plan past
    // its time reads expired here, and gets nothing.
    const { plan } = toRecord(row, latest, now)
    if (plan.status !== 'approved' || plan.outcome.type !== 'calls') return null
    const arm = await executingArm(tx, userId, row.walletId)
    if (!arm || arm.address !== parseAccountId(plan.resolution.account.caip10).address.toLowerCase()) return null

    const released = { planHash: plan.planHash, calls: plan.outcome.calls, address: arm.address, profile: arm.profile }
    const before = handedOffAt(latest.detail)
    if (before) return { ...released, handedOffAt: before, first: false }

    const at = now.toISOString()
    await tx.insert(planEvents).values({
      planId,
      planVersion: version,
      status: 'approved',
      detail: { ...((latest.detail as Record<string, unknown> | null) ?? {}), handedOffAt: at },
    })
    return { ...released, handedOffAt: at, first: true }
  })
}

export interface ExecutionReport extends PlanRef {
  txHash: string
  /** Who the chain says sent `txHash`. The caller read it; this compares it. */
  sender: string
}

/**
 * `approved -> submitted`, on the agent's word and the chain's.
 *
 * The sender is checked here rather than trusted from the caller's own
 * comparison, so no writer can move an approved plan to submitted with a
 * transaction its arm did not send. From there the receipts job carries it,
 * exactly as it does a browser-signed plan.
 */
export async function recordExecution(
  db: PlanDb,
  { userId, planId, version, txHash, sender }: ExecutionReport,
  now = new Date(),
): Promise<PlanStatus> {
  if (!TX_HASH.test(txHash)) throw new PlanError('missing_tx_hash', 'a report needs the transaction hash')
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(plans)
      .where(and(eq(plans.id, planId), eq(plans.version, version), eq(plans.userId, userId)))
      .for('update')
    if (!row) throw new PlanError('not_found', `no plan ${planId} v${version}`)
    const latest = await latestEvent(tx, planId, version)
    if (!latest) throw new PlanIntegrityError(`plan ${planId} v${version} has no events`)

    // Expiry is derived here too: an approved plan past its time is expired,
    // and an expired plan takes no report.
    const { plan } = toRecord(row, latest, now)
    if (plan.status !== 'approved') {
      throw new PlanError('illegal_transition', `${plan.status} -> submitted is not allowed`)
    }
    const released = handedOffAt(latest.detail)
    if (!released) throw new PlanError('illegal_transition', 'the calls of this plan were never handed out')
    const arm = await executingArm(tx, userId, row.walletId)
    if (!arm) throw new PlanError('not_agentic', 'the wallet this plan was bound to is no longer an agent wallet')
    if (arm.address !== sender.toLowerCase()) {
      throw new PlanError('wrong_sender', `the transaction was sent by ${sender.toLowerCase()}, not by ${arm.address}`)
    }
    await tx.insert(planEvents).values({
      planId,
      planVersion: version,
      status: 'submitted',
      detail: { txHash, handedOffAt: released, reportedBy: 'agent' },
    })
    return 'submitted' as const
  })
}
