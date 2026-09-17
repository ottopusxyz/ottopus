import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'

/** drizzle-kit writes this marker between statements. */
const BREAKPOINT = '--> statement-breakpoint'

export async function migrationFiles(dir: string): Promise<string[]> {
  const names = (await readdir(dir)).filter((n) => n.endsWith('.sql')).sort()
  return names.map((n) => join(dir, n))
}

/** Split a migration into individual statements, dropping comments-only chunks. */
export async function statementsIn(file: string): Promise<string[]> {
  const sql = await readFile(file, 'utf8')
  return sql
    .split(BREAKPOINT)
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !/^(--[^\n]*\n?)+$/.test(s))
}
