import { eq, sql } from 'drizzle-orm'
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core'
import type * as schema from '../db/schema.js'
import { users } from '../db/schema.js'

/**
 * Any Postgres drizzle instance, not the postgres-js one specifically — the
 * tests run this against PGlite, and the point of testing it at all is that
 * ON CONFLICT behaves the way this code assumes.
 */
export type UserDb = PgDatabase<PgQueryResultHKT, typeof schema>

/**
 * Turns a verified Privy DID into an Ottopus user id.
 *
 * The upsert is the sign-up path: there is no separate registration step, so a
 * first authenticated request is what creates the row. `onConflictDoUpdate`
 * rather than a read-then-insert — two requests arriving together from the same
 * new session would otherwise race, and the unique index would fail one of them
 * with an error the caller could do nothing about.
 *
 * The update is a no-op write on `privy_did`, which is what makes the statement
 * return the existing row rather than nothing on conflict.
 */
export async function userIdForDid(db: UserDb, did: string): Promise<string> {
  const [row] = await db
    .insert(users)
    .values({ privyDid: did })
    .onConflictDoUpdate({
      target: users.privyDid,
      set: { privyDid: sql`excluded.privy_did` },
    })
    .returning({ id: users.id })

  if (row) return row.id

  // Belt and braces: RETURNING has given us a row on every path above, but a
  // silent empty result would otherwise become "undefined" flowing into a
  // user id, which is the kind of thing that ends up in a plan.
  const [existing] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.privyDid, did))
    .limit(1)

  if (!existing) throw new Error(`Could not resolve a user for ${did}`)
  return existing.id
}
