import { and, eq, sql } from 'drizzle-orm'
import { type Call, PlanIntegrityError, type PlanStatus, parseAccountId } from '../core/index.js'
import { planEvents, plans } from '../db/schema.js'
import type { SentTransaction } from '../verify/index.js'
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
  /** What the chain says `txHash` is. The caller read it; this compares it. */
  sent: SentTransaction
}

/** Whether a transaction is this call and nothing else: same destination, same value, same calldata. */
function isCall(call: Call, sent: SentTransaction): boolean {
  return (
    sent.to?.toLowerCase() === parseAccountId(call.to).address.toLowerCase() &&
    BigInt(sent.value) === BigInt(call.value) &&
    sent.input.toLowerCase() === call.data.toLowerCase()
  )
}

/**
 * `approved -> submitted`, on the agent's word and the chain's.
 *
 * Everything is checked here rather than trusted from the caller's own
 * comparison, so no writer can move an approved plan to submitted with a
 * transaction that is not its execution: the plan's arm sent it, it carries
 * the plan's last call unchanged, and no other plan has already been settled
 * with it. An older or unrelated transaction from the same wallet is none of
 * those, and the receipts job would otherwise confirm the plan on the back
 * of it. From there the job carries it, exactly as it does a browser-signed
 * plan.
 */
export async function recordExecution(
  db: PlanDb,
  { userId, planId, version, txHash, sent }: ExecutionReport,
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
    const sender = sent.from.toLowerCase()
    if (arm.address !== sender) {
      throw new PlanError('wrong_sender', `the transaction was sent by ${sender}, not by ${arm.address}`)
    }
    // A plan with several calls reports its last one, so that is the one compared.
    const last = plan.outcome.type === 'calls' ? plan.outcome.calls.at(-1) : undefined
    if (!last || !isCall(last, sent)) {
      throw new PlanError('wrong_call', 'the transaction does not carry the call this plan approved')
    }
    // One transaction settles one plan. Two reports of one hash hold different
    // plan rows, so they are made to queue on the hash itself before looking.
    const hash = txHash.toLowerCase()
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${hash}, 0))`)
    const [taken] = await tx
      .select({ planId: planEvents.planId })
      .from(planEvents)
      .where(and(eq(planEvents.status, 'submitted'), sql`lower(${planEvents.detail}->>'txHash') = ${hash}`))
      .limit(1)
    if (taken) throw new PlanError('hash_taken', 'the transaction is already on record as the execution of another plan')
    await tx.insert(planEvents).values({
      planId,
      planVersion: version,
      status: 'submitted',
      detail: { txHash, handedOffAt: released, reportedBy: 'agent' },
    })
    return 'submitted' as const
  })
}
