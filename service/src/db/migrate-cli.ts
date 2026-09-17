import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import postgres from 'postgres'

/**
 * Applies pending migrations. Safe to run repeatedly — drizzle records what it
 * has applied and skips those.
 *
 * Loads .env when present for local use; on a platform the environment is
 * already set, so a missing file is not an error.
 */
try {
  process.loadEnvFile()
} catch {
  // No .env — expected on Railway and in CI.
}

const url = process.env.DATABASE_URL
if (!url) {
  console.error('DATABASE_URL is not set.')
  process.exit(1)
}

/**
 * Supabase's transaction pooler does not support prepared statements or hold a
 * session across statements, so DDL through it fails in ways that read as
 * random. Migrations need the session pooler or a direct connection.
 */
if (url.includes(':6543')) {
  console.error(
    'DATABASE_URL points at the transaction pooler (:6543).\n' +
      'Use the session pooler or direct connection (:5432) — same host, change the port.',
  )
  process.exit(1)
}

// Drizzle creates its tracking table with IF NOT EXISTS, which emits NOTICEs on
// every run after the first. They are not errors and would be noise in CI.
const sql = postgres(url, { max: 1, connect_timeout: 15, onnotice: () => {} })

try {
  await migrate(drizzle(sql), { migrationsFolder: './drizzle' })
  console.log('migrations applied')
} catch (err) {
  console.error('migration failed:', err instanceof Error ? err.message : String(err))
  process.exitCode = 1
} finally {
  await sql.end({ timeout: 5 })
}
