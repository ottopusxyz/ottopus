import { defineConfig } from 'drizzle-kit'

/**
 * Migrations are generated offline and committed, then applied by the platform.
 * The generated SQL is edited by hand where drizzle cannot express something —
 * RLS policies and the plan immutability trigger, in particular.
 */
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './drizzle',
  casing: 'snake_case',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? '',
  },
})
