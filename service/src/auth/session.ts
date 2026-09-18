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

/** What Privy told us about the person, if the sign-in method carried it. */
export interface UserProfile {
  email?: string | undefined
  name?: string | undefined
}

export interface SessionUser {
  id: string
  privyDid: string
  email: string | null
  name: string | null
}

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
export async function upsertUser(
  db: UserDb,
  did: string,
  profile: UserProfile = {},
): Promise<SessionUser> {
  const columns = {
    id: users.id,
    privyDid: users.privyDid,
    email: users.email,
    name: users.name,
  }

  const [row] = await db
    .insert(users)
    .values({ privyDid: did, email: profile.email ?? null, name: profile.name ?? null })
    .onConflictDoUpdate({
      target: users.privyDid,
      set: {
        privyDid: sql`excluded.privy_did`,
        // coalesce, not overwrite: signing back in with a wallet carries no
        // name, and that must not erase the one Google gave us last time.
        email: sql`coalesce(excluded.email, ${users.email})`,
        name: sql`coalesce(excluded.name, ${users.name})`,
      },
    })
    .returning(columns)

  if (row) return row

  // Belt and braces: RETURNING has given us a row on every path above, but a
  // silent empty result would otherwise become "undefined" flowing into a
  // user id, which is the kind of thing that ends up in a plan.
  const [existing] = await db.select(columns).from(users).where(eq(users.privyDid, did)).limit(1)

  if (!existing) throw new Error(`Could not resolve a user for ${did}`)
  return existing
}

/** The id alone, for callers that only need the foreign key. */
export async function userIdForDid(db: UserDb, did: string): Promise<string> {
  return (await upsertUser(db, did)).id
}

/**
 * The stored profile for an id, or null.
 *
 * Read-only, unlike upsertUser: the MCP surface uses this to say who an agent
 * is acting for, and a lookup that could create someone would be the wrong
 * shape for a surface that must never write a person into existence.
 */
export async function findUserById(db: UserDb, id: string): Promise<SessionUser | null> {
  const [row] = await db
    .select({ id: users.id, privyDid: users.privyDid, email: users.email, name: users.name })
    .from(users)
    .where(eq(users.id, id))
    .limit(1)
  return row ?? null
}
