import { and, eq, isNull } from 'drizzle-orm'
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core'
import type { PrivyWallet } from '../auth/privy.js'
import { EVM_ADDRESS_RE } from '../core/caip.js'
import type * as schema from '../db/schema.js'
import { linkedWallets } from '../db/schema.js'
import { MAX_ARMS, reconcile } from './reconcile.js'

export type WalletDb = PgDatabase<PgQueryResultHKT, typeof schema>

/** An arm, as the web app and the MCP tools see one. */
export interface Arm {
  id: string
  namespace: string
  address: string
  label: string | null
  walletType: string
  isWatchOnly: boolean
  provedAt: string | null
  createdAt: string
}

export class WalletError extends Error {
  constructor(
    readonly code: 'invalid_address' | 'already_linked' | 'too_many_wallets' | 'not_found',
    message: string,
  ) {
    super(message)
  }
}

const columns = {
  id: linkedWallets.id,
  namespace: linkedWallets.namespace,
  address: linkedWallets.address,
  label: linkedWallets.label,
  walletType: linkedWallets.walletType,
  isWatchOnly: linkedWallets.isWatchOnly,
  provedAt: linkedWallets.provedAt,
  createdAt: linkedWallets.createdAt,
}

interface Row {
  id: string
  namespace: string
  address: string
  label: string | null
  walletType: string
  isWatchOnly: boolean
  provedAt: Date | null
  createdAt: Date
}

const toArm = (row: Row): Arm => ({
  ...row,
  provedAt: row.provedAt?.toISOString() ?? null,
  createdAt: row.createdAt.toISOString(),
})

/** Active arms, oldest first — the order they were linked is the order shown. */
async function activeRows(db: WalletDb, userId: string): Promise<Row[]> {
  return db
    .select(columns)
    .from(linkedWallets)
    .where(and(eq(linkedWallets.userId, userId), isNull(linkedWallets.unlinkedAt)))
    .orderBy(linkedWallets.createdAt)
}

export async function listWallets(db: WalletDb, userId: string): Promise<Arm[]> {
  return (await activeRows(db, userId)).map(toArm)
}

export interface SyncResult {
  wallets: Arm[]
  /** Addresses that did not fit under the cap, so the app can say which. */
  overflow: string[]
}

/**
 * Bring our arms in line with what the identity token attests.
 *
 * One transaction, and the read is inside it: two tabs signing in at once
 * would otherwise both see "no wallets", both decide to insert, and one would
 * lose to the unique index with an error the person could do nothing about.
 *
 * Idempotent by construction. The web app calls this on every cold boot and
 * after every link, and a call that changes nothing costs one select.
 */
export async function syncWallets(
  db: WalletDb,
  userId: string,
  attested: PrivyWallet[],
): Promise<SyncResult> {
  return db.transaction(async (tx) => {
    const existing = await activeRows(tx as WalletDb, userId)
    const plan = reconcile(existing, attested)

    for (const id of plan.unlink) {
      // Scoped by user as well as id. The id came from our own read here, but
      // this is the only statement in the file that could touch another
      // person's row, and the cost of the extra predicate is nothing.
      await tx
        .update(linkedWallets)
        .set({ unlinkedAt: new Date() })
        .where(and(eq(linkedWallets.id, id), eq(linkedWallets.userId, userId)))
    }

    if (plan.link.length > 0) {
      await tx.insert(linkedWallets).values(
        plan.link.map((w) => ({
          userId,
          namespace: w.namespace,
          address: w.address,
          walletType: w.walletType,
          provedAt: w.provedAt,
          ownershipProof: w.ownershipProof,
        })),
      )
    }

    const wallets = (await activeRows(tx as WalletDb, userId)).map(toArm)
    return { wallets, overflow: plan.overflow }
  })
}

export interface WatchOnlyInput {
  address: string
  label?: string | undefined
  /** 'safe' or 'watch_only'. A Safe is watch-only until it can be proved. */
  walletType?: string | undefined
}

/**
 * A pasted address. Nobody proved it, and the row says so.
 *
 * This is the one path Privy cannot cover: linking requires signing, and the
 * whole point of a watch-only arm is that no one here can sign for it. It is
 * also how a Safe gets in — a contract account cannot `personal_sign`, so it
 * arrives unproven and stays execution-ineligible.
 */
export async function addWatchOnlyWallet(
  db: WalletDb,
  userId: string,
  input: WatchOnlyInput,
): Promise<Arm> {
  const address = input.address.trim().toLowerCase()
  if (!EVM_ADDRESS_RE.test(address)) {
    throw new WalletError('invalid_address', 'Not a 20-byte hex address')
  }

  return db.transaction(async (tx) => {
    const existing = await activeRows(tx as WalletDb, userId)
    if (existing.length >= MAX_ARMS) {
      throw new WalletError('too_many_wallets', `Otto has ${MAX_ARMS} arms and they are all full`)
    }
    // Checked rather than left to the unique index, so the caller gets a reason
    // instead of a constraint name — and so "you already have this one" does
    // not read as a server error.
    if (existing.some((w) => w.address === address)) {
      throw new WalletError('already_linked', 'That address is already linked')
    }

    const [row] = await tx
      .insert(linkedWallets)
      .values({
        userId,
        address,
        label: input.label?.trim() || null,
        walletType: input.walletType === 'safe' ? 'safe' : 'watch_only',
        isWatchOnly: true,
      })
      .returning(columns)

    if (!row) throw new WalletError('not_found', 'The wallet could not be stored')
    return toArm(row)
  })
}

/**
 * Soft delete, always. A plan references the wallet it was bound to and plans
 * are append-only, so removing the row would either break the audit trail or
 * collide with the immutability trigger.
 *
 * Only ever unlinks here. A wallet Privy still attests will come back on the
 * next sync, which is correct — the web app unlinks it at Privy first.
 */
export async function unlinkWallet(db: WalletDb, userId: string, id: string): Promise<void> {
  const rows = await db
    .update(linkedWallets)
    .set({ unlinkedAt: new Date() })
    .where(
      and(
        eq(linkedWallets.id, id),
        eq(linkedWallets.userId, userId),
        isNull(linkedWallets.unlinkedAt),
      ),
    )
    .returning({ id: linkedWallets.id })

  // A wallet belonging to someone else and a wallet that does not exist give
  // the same answer, deliberately: the difference is only useful for probing
  // which ids are real.
  if (rows.length === 0) throw new WalletError('not_found', 'No such wallet')
}
