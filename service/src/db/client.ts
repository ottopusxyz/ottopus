import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema.js'

/**
 * The only place in the codebase that holds a database connection.
 *
 * The service connects as service_role and does its own authorization — the
 * browser never gets a Supabase key, so this connection is not a fallback for
 * client access, it is the whole path to data.
 *
 * Long-lived container, so use the direct connection or the session pooler.
 * Supabase's transaction pooler (port 6543) does not support prepared
 * statements, which postgres.js uses by default; if you point DATABASE_URL
 * there, set `prepare: false` or queries will fail in ways that look random.
 */
let client: postgres.Sql | undefined

export function getDb(url: string) {
  client ??= postgres(url, {
    max: 10,
    idle_timeout: 20,
    connect_timeout: 10,
  })
  return drizzle(client, { schema, casing: 'snake_case' })
}

export type Db = ReturnType<typeof getDb>

/** Close the pool on shutdown so in-flight queries finish first. */
export async function closeDb(): Promise<void> {
  await client?.end({ timeout: 5 })
  client = undefined
}

export { schema }
