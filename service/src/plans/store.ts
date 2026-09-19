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
  /** What the latest event carried — the tx hash once submitted, a reason once failed. */
  statusDetail: Record<string, unknown> | null
}

/** What a list row needs. No calls, no evidence — the review page has those. */
export interface PlanSummary {
  id: string
  version: number
  status: PlanStatus
  kind: Plan['intent']['kind']
  summary: string
  reason: string
  account: { caip10: string; label?: string | undefined }
  chainId: string
  /** The asset that leaves, in its own words when the plan recorded them. */
  asset: { id: string; amount: string; symbol: string | null; decimals: number | null } | null
  recipient: { address: string; name: string | null } | null
  /** The block reason, for a row that must say what did not happen. */
  blockedReason: string | null
  createdVia: 'agent' | 'web'
  expiresAt: string
  createdAt: string
  statusAt: string
}

export function summarise(record: PlanRecord): PlanSummary {
  const { plan } = record
  const [namespace, reference] = plan.resolution.account.caip10.split(':')
  const words = (id: string) => plan.humanPlan.assets?.find((a) => a.id.toLowerCase() === id.toLowerCase())
  const transfer = plan.intent.kind === 'transfer' ? plan.intent : null
  const asset = transfer
    ? { id: transfer.asset, amount: transfer.amount, symbol: words(transfer.asset)?.symbol ?? null, decimals: words(transfer.asset)?.decimals ?? null }
    : null
  const recipient = transfer
    ? { address: transfer.to.split(':')[2] ?? transfer.to, name: transfer.toName ?? null }
    : null
  return {
    id: plan.id,
    version: plan.version,
    status: plan.status,
    kind: plan.intent.kind,
    summary: plan.humanPlan.summary,
    reason: plan.resolution.reason,
    account: plan.resolution.account,
    chainId: `${namespace}:${reference}`,
    asset,
    recipient,
    blockedReason: plan.humanPlan.warnings.find((w) => w.severity === 'block')?.message ?? null,
    createdVia: plan.createdVia,
    expiresAt: plan.expiresAt,
    createdAt: record.createdAt,
    statusAt: record.statusAt,
  }
}

/** Waiting on a person first, then newest first. The order every list shows. */
export function byAttentionThenNewest(a: PlanRecord, b: PlanRecord): number {
  const pa = isPending(a.plan.status) ? 0 : 1
  const pb = isPending(b.plan.status) ? 0 : 1
  if (pa !== pb) return pa - pb
  return b.createdAt < a.createdAt ? -1 : b.createdAt > a.createdAt ? 1 : 0
}

/** A transaction hash. What `submitted` must carry. */
export const TX_HASH = /^0x[0-9a-f]{64}$/i

/** A plan starts here or nowhere. `blocked` is verify (#77) refusing it. */
const INITIAL_STATUSES: readonly PlanStatus[] = ['draft', 'awaiting_review', 'blocked']

type PlanRow = typeof plans.$inferSelect
type EventRow = Pick<typeof planEvents.$inferSelect, 'status' | 'createdAt' | 'detail'>

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
    statusDetail: (event.detail as Record<string, unknown> | null) ?? null,
  }
}

async function latestEvent(db: PlanDb, planId: string, version: number): Promise<EventRow | null> {
  const [row] = await db
    .select({ status: planEvents.status, createdAt: planEvents.createdAt, detail: planEvents.detail })
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
      .returning({ status: planEvents.status, createdAt: planEvents.createdAt, detail: planEvents.detail })
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
    // The hash lives on the latest event, and confirmed and failed are the
    // events after submitted. A writer that omits it — the browser does —
    // must not make the plan forget which transaction it became.
    const carried = from === 'submitted' && (to === 'confirmed' || to === 'failed') ? latest.detail : null
    const hash = (carried as Record<string, unknown> | null)?.txHash
    const written = detail?.txHash === undefined && typeof hash === 'string' ? { ...detail, txHash: hash } : detail
    await tx.insert(planEvents).values({ planId, planVersion: version, status: to, detail: written ?? null })
    return to
  })
}

/**
 * Every plan, any user's, whose latest event is `submitted`: what the receipt
 * job watches. Reads start from the submitted events — each version has at
 * most one, and there are few — rather than from every plan of every user.
 */
export async function listSubmitted(db: PlanDb): Promise<PlanRecord[]> {
  const submitted = await db
    .select({ planId: planEvents.planId })
    .from(planEvents)
    .where(eq(planEvents.status, 'submitted'))
  if (submitted.length === 0) return []
  const ids = [...new Set(submitted.map((e) => e.planId))]
  const latest = await db
    .selectDistinctOn([planEvents.planId, planEvents.planVersion], {
      planId: planEvents.planId,
      planVersion: planEvents.planVersion,
      status: planEvents.status,
      createdAt: planEvents.createdAt,
      detail: planEvents.detail,
    })
    .from(planEvents)
    .where(inArray(planEvents.planId, ids))
    .orderBy(planEvents.planId, planEvents.planVersion, desc(planEvents.seq))
  const still = latest.filter((e) => e.status === 'submitted')
  if (still.length === 0) return []
  const byVersion = new Map(still.map((e) => [`${e.planId}:${e.planVersion}`, e]))
  const rows = await db
    .select()
    .from(plans)
    .where(inArray(plans.id, [...new Set(still.map((e) => e.planId))]))
  const records: PlanRecord[] = []
  for (const row of rows) {
    const event = byVersion.get(`${row.id}:${row.version}`)
    if (event) records.push(toRecord(row, event))
  }
  return records
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
      detail: planEvents.detail,
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

/** How much history one list carries. Activity paging is #26's problem. */
const LIST_LIMIT = 200

/**
 * Every plan of this person's, one row per plan id at its latest version,
 * waiting-on-you first and then newest first. Superseded versions are not
 * separate rows: the replacement is the plan, and the old version's status
 * is history the review page can show.
 */
export async function listPlans(db: PlanDb, userId: string): Promise<PlanRecord[]> {
  const now = new Date()
  const rows = await db
    .select()
    .from(plans)
    .where(eq(plans.userId, userId))
    .orderBy(desc(plans.createdAt), desc(plans.version))
    .limit(LIST_LIMIT * 2)
  if (rows.length === 0) return []

  const latestVersion = new Map<string, (typeof rows)[number]>()
  for (const row of rows) {
    const held = latestVersion.get(row.id)
    if (!held || row.version > held.version) latestVersion.set(row.id, row)
  }
  const chosen = [...latestVersion.values()].slice(0, LIST_LIMIT)

  const latest = await db
    .selectDistinctOn([planEvents.planId, planEvents.planVersion], {
      planId: planEvents.planId,
      planVersion: planEvents.planVersion,
      status: planEvents.status,
      createdAt: planEvents.createdAt,
      detail: planEvents.detail,
    })
    .from(planEvents)
    .where(inArray(planEvents.planId, chosen.map((r) => r.id)))
    .orderBy(planEvents.planId, planEvents.planVersion, desc(planEvents.seq))
  const byVersion = new Map(latest.map((e) => [`${e.planId}:${e.planVersion}`, e]))

  const records: PlanRecord[] = []
  for (const row of chosen) {
    const event = byVersion.get(`${row.id}:${row.version}`)
    if (!event) throw new PlanIntegrityError(`plan ${row.id} v${row.version} has no events`)
    records.push(toRecord(row, event, now))
  }
  return records.sort(byAttentionThenNewest)
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
