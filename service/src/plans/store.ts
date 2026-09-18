import { and, desc, eq, gt, inArray, isNull, sql } from 'drizzle-orm'
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core'
import {
  type Plan,
  PlanIntegrityError,
  type PlanStatus,
  canTransition,
  effectiveStatus,
  isPending,
  parsePlan,
} from '../core/index.js'
import type * as schema from '../db/schema.js'
import { planEvents, plans, reviewTokens } from '../db/schema.js'
import { hashSecret, mintSecret } from '../oauth/crypto.js'

/**
 * Where a plan lives between the tool call that built it and the wallet that
 * signs it.
 *
 * Plans are append-only, enforced by a trigger, so nothing here updates a plan
 * row. Status is the latest row in plan_events, and moving a plan means
 * inserting an event the state machine allows. Every read and write takes the
 * user id, and a plan that is not theirs does not exist.
 */

/** Any Postgres drizzle — the tests run this against PGlite. */
export type PlanDb = PgDatabase<PgQueryResultHKT, typeof schema>

export class PlanError extends Error {
  constructor(
    readonly code: 'not_found' | 'illegal_transition' | 'illegal_initial_status' | 'missing_tx_hash',
    message: string,
  ) {
    super(message)
  }
}

export interface PlanRecord {
  /** With `status` already derived — a pending plan past its expiry reads expired. */
  plan: Plan
  walletId: string | null
  grantId: string | null
  createdAt: string
  /** When the latest event was written. */
  statusAt: string
}

/** What a list row needs. No calls, no evidence — the review page has those. */
export interface PlanSummary {
  id: string
  version: number
  status: PlanStatus
  summary: string
  reason: string
  account: { caip10: string; label?: string | undefined }
  createdVia: 'agent' | 'web'
  expiresAt: string
  createdAt: string
}

export function summarise(record: PlanRecord): PlanSummary {
  const { plan } = record
  return {
    id: plan.id,
    version: plan.version,
    status: plan.status,
    summary: plan.humanPlan.summary,
    reason: plan.resolution.reason,
    account: plan.resolution.account,
    createdVia: plan.createdVia,
    expiresAt: plan.expiresAt,
    createdAt: record.createdAt,
  }
}

/** A transaction hash. What `submitted` must carry. */
export const TX_HASH = /^0x[0-9a-f]{64}$/i

/** A plan starts here or nowhere. `blocked` is verify (#77) refusing it. */
const INITIAL_STATUSES: readonly PlanStatus[] = ['draft', 'awaiting_review', 'blocked']

type PlanRow = typeof plans.$inferSelect
type EventRow = Pick<typeof planEvents.$inferSelect, 'status' | 'createdAt'>

/**
 * Status is not stored in the payload — it lives in events — and the hash does
 * not cover it, so stripping it here changes nothing the hash binds.
 */
function payloadOf(plan: Plan): Omit<Plan, 'status'> {
  const { status: _status, ...rest } = plan
  return rest
}

function toRecord(row: PlanRow, event: EventRow, now = new Date()): PlanRecord {
  const plan = parsePlan({ ...(row.payload as object), status: event.status })
  // The column is what the unique index and the review token bind to; the
  // payload is what parsePlan just proved. They must agree.
  if (plan.planHash !== row.planHash) {
    throw new PlanIntegrityError(`plan ${row.id} v${row.version}: column hash differs from payload hash`)
  }
  plan.status = effectiveStatus(plan.status, row.expiresAt, now)
  return {
    plan,
    walletId: row.walletId,
    grantId: row.grantId,
    createdAt: row.createdAt.toISOString(),
    statusAt: event.createdAt.toISOString(),
  }
}

async function latestEvent(db: PlanDb, planId: string, version: number): Promise<EventRow | null> {
  const [row] = await db
    .select({ status: planEvents.status, createdAt: planEvents.createdAt })
    .from(planEvents)
    .where(and(eq(planEvents.planId, planId), eq(planEvents.planVersion, version)))
    .orderBy(desc(planEvents.seq))
    .limit(1)
  return row ?? null
}

export interface CreatePlanInput {
  plan: Plan
  walletId?: string | null
  grantId?: string | null
}

/**
 * The plan row and its first event, in one transaction. A plan with no event
 * has no status, and a status with no plan is an orphan; neither should be
 * observable, even briefly.
 */
export async function createPlan(
  db: PlanDb,
  { plan, walletId = null, grantId = null }: CreatePlanInput,
): Promise<PlanRecord> {
  if (!INITIAL_STATUSES.includes(plan.status)) {
    throw new PlanError('illegal_initial_status', `a plan cannot start as ${plan.status}`)
  }
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(plans)
      .values({
        id: plan.id,
        version: plan.version,
        planHash: plan.planHash,
        userId: plan.userId,
        walletId,
        grantId,
        intent: plan.intent,
        payload: payloadOf(plan),
        reason: plan.resolution.reason,
        expiresAt: new Date(plan.expiresAt),
      })
      .returning()
    const [event] = await tx
      .insert(planEvents)
      .values({ planId: plan.id, planVersion: plan.version, status: plan.status })
      .returning({ status: planEvents.status, createdAt: planEvents.createdAt })
    return toRecord(row!, event!)
  })
}

export interface TransitionInput {
  userId: string
  planId: string
  version: number
  to: PlanStatus
  /** Tx hash, error, which re-plan trigger fired. */
  detail?: Record<string, unknown> | undefined
}

/**
 * Insert an event, if the state machine allows it from where the plan is now.
 *
 * The plan row is locked for the transaction so two transitions racing — a
 * cancel from chat and a sign from the browser — serialise, and the second
 * one sees the first. The lock is `FOR UPDATE` on a row that is never updated;
 * that is fine, locks do not fire triggers.
 */
export async function transition(
  db: PlanDb,
  { userId, planId, version, to, detail }: TransitionInput,
): Promise<PlanStatus> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({ id: plans.id, expiresAt: plans.expiresAt })
      .from(plans)
      .where(and(eq(plans.id, planId), eq(plans.version, version), eq(plans.userId, userId)))
      .for('update')
    if (!row) throw new PlanError('not_found', `no plan ${planId} v${version}`)

    const latest = await latestEvent(tx, planId, version)
    if (!latest) throw new PlanIntegrityError(`plan ${planId} v${version} has no events`)

    const from = effectiveStatus(latest.status as PlanStatus, row.expiresAt)
    if (!canTransition(from, to)) {
      throw new PlanError('illegal_transition', `${from} -> ${to} is not allowed`)
    }
    // Submitted is the one state our side cannot take back, and the one that
    // needs a reference for receipt tracking. A submission with nothing to
    // track is a plan stuck between two worlds; refuse it here so every
    // writer, not just the web route, is held to it.
    if (to === 'submitted' && !TX_HASH.test(String(detail?.txHash ?? ''))) {
      throw new PlanError('missing_tx_hash', 'submitted requires detail.txHash')
    }
    await tx.insert(planEvents).values({ planId, planVersion: version, status: to, detail: detail ?? null })
    return to
  })
}

/** The plan, at a version or at its latest. Null if it is not this user's. */
export async function findPlan(
  db: PlanDb,
  userId: string,
  planId: string,
  version?: number,
): Promise<PlanRecord | null> {
  const [row] = await db
    .select()
    .from(plans)
    .where(
      and(
        eq(plans.id, planId),
        eq(plans.userId, userId),
        version === undefined ? undefined : eq(plans.version, version),
      ),
    )
    .orderBy(desc(plans.version))
    .limit(1)
  if (!row) return null
  const event = await latestEvent(db, row.id, row.version)
  if (!event) throw new PlanIntegrityError(`plan ${row.id} v${row.version} has no events`)
  return toRecord(row, event)
}

/**
 * Plans waiting on this person, newest first.
 *
 * Pending implies not expired, so the query only reads plans whose expiry is
 * still ahead — that keeps it from scanning a user's whole history — and the
 * latest event per version decides the rest. A superseded version carries a
 * terminal event, so old versions fall out without any version arithmetic.
 */
export async function listPending(db: PlanDb, userId: string): Promise<PlanRecord[]> {
  const now = new Date()
  const rows = await db
    .select()
    .from(plans)
    .where(and(eq(plans.userId, userId), gt(plans.expiresAt, now)))
    .orderBy(desc(plans.createdAt))
  if (rows.length === 0) return []

  const ids = [...new Set(rows.map((r) => r.id))]
  const latest = await db
    .selectDistinctOn([planEvents.planId, planEvents.planVersion], {
      planId: planEvents.planId,
      planVersion: planEvents.planVersion,
      status: planEvents.status,
      createdAt: planEvents.createdAt,
    })
    .from(planEvents)
    .where(inArray(planEvents.planId, ids))
    .orderBy(planEvents.planId, planEvents.planVersion, desc(planEvents.seq))
  const byVersion = new Map(latest.map((e) => [`${e.planId}:${e.planVersion}`, e]))

  const records: PlanRecord[] = []
  for (const row of rows) {
    const event = byVersion.get(`${row.id}:${row.version}`)
    if (!event) throw new PlanIntegrityError(`plan ${row.id} v${row.version} has no events`)
    const record = toRecord(row, event, now)
    if (isPending(record.plan.status)) records.push(record)
  }
  return records
}

export interface MintTokenInput {
  planId: string
  version: number
  expiresAt: Date
}

/**
 * A review link. The raw token is returned once and never stored; #37 owns the
 * policy around it (how long, when it dies), this owns the row.
 */
export async function mintReviewToken(
  db: PlanDb,
  { planId, version, expiresAt }: MintTokenInput,
): Promise<{ token: string; expiresAt: string }> {
  const token = mintSecret()
  await db
    .insert(reviewTokens)
    .values({ tokenHash: hashSecret(token), planId, planVersion: version, expiresAt })
  return { token, expiresAt: expiresAt.toISOString() }
}

export interface ResolvedReview extends PlanRecord {
  linkExpiresAt: string
}

/**
 * The plan behind a link, for the person it belongs to. A wrong token, a dead
 * token and someone else's plan all come back null — the caller answers one
 * 404 and never says which.
 */
export async function resolveReviewToken(
  db: PlanDb,
  userId: string,
  token: string,
): Promise<ResolvedReview | null> {
  const now = new Date()
  const [hit] = await db
    .select({ plan: plans, linkExpiresAt: reviewTokens.expiresAt })
    .from(reviewTokens)
    .innerJoin(
      plans,
      and(eq(plans.id, reviewTokens.planId), eq(plans.version, reviewTokens.planVersion)),
    )
    .where(
      and(
        eq(reviewTokens.tokenHash, hashSecret(token)),
        isNull(reviewTokens.revokedAt),
        gt(reviewTokens.expiresAt, now),
        eq(plans.userId, userId),
      ),
    )
    .limit(1)
  if (!hit) return null
  const event = await latestEvent(db, hit.plan.id, hit.plan.version)
  if (!event) throw new PlanIntegrityError(`plan ${hit.plan.id} v${hit.plan.version} has no events`)
  return { ...toRecord(hit.plan, event, now), linkExpiresAt: hit.linkExpiresAt.toISOString() }
}

/** Every live link to a version. Superseding a plan calls this. */
export async function revokeReviewTokens(db: PlanDb, planId: string, version: number): Promise<number> {
  const rows = await db
    .update(reviewTokens)
    .set({ revokedAt: sql`now()` })
    .where(
      and(
        eq(reviewTokens.planId, planId),
        eq(reviewTokens.planVersion, version),
        isNull(reviewTokens.revokedAt),
      ),
    )
    .returning({ id: reviewTokens.id })
  return rows.length
}
