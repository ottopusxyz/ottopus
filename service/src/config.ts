/**
 * Environment config, parsed and validated once at boot.
 *
 * Every host we may run on (Railway, Render, Fly, a plain EC2 box) injects
 * config through the environment and nothing else. Read env vars here, never
 * scattered through the codebase, and fail loudly at startup rather than at the
 * first request that needs a missing value.
 */

/**
 * Local development reads .env; every platform injects the environment
 * directly and ships no such file. Absent is the normal case in production,
 * so a missing file is not an error — but a malformed one is, and that should
 * be said at boot rather than discovered at the first request that needs it.
 *
 * Values already in the environment win: `pnpm db:migrate` and a one-off
 * `PORT=1234 pnpm start` must not be overridden by a stale file.
 */
function loadDotEnv(): void {
  try {
    process.loadEnvFile()
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.error(`[config] .env could not be parsed: ${(err as Error).message}`)
    }
  }
}

loadDotEnv()

export type NodeEnv = 'development' | 'production' | 'test'

export interface Config {
  nodeEnv: NodeEnv
  /** Platforms inject PORT. Never hardcode it. */
  port: number
  /** Must be 0.0.0.0 in a container — 127.0.0.1 is unreachable from outside. */
  host: string
  /** Public HTTPS origin this service is reachable at, for OAuth redirects. */
  publicUrl: string | undefined
  gitCommit: string
  /** Postgres. Absent locally until someone points at a database. */
  databaseUrl: string | undefined
  /**
   * Privy. The verification key is a public ES256 key, not a secret — the
   * service verifies tokens offline and never calls Privy's API, so there is
   * no app secret here and nothing to leak if this value is read.
   */
  privyAppId: string | undefined
  privyVerificationKey: string | undefined
  /**
   * Browser origins allowed to call /api. The web app is always cross-origin —
   * ottopus.xyz calling api.ottopus.xyz in production, :3000 calling :8787
   * locally — so this is not optional, and an allow-list rather than `*`
   * because a bearer token is worth having a list for.
   */
  webOrigins: string[]
}

class ConfigError extends Error {}

function readEnum(name: string, allowed: readonly string[], fallback: string): string {
  const raw = process.env[name]
  if (raw === undefined || raw === '') return fallback
  if (!allowed.includes(raw)) {
    throw new ConfigError(`${name} must be one of ${allowed.join(', ')} — got "${raw}"`)
  }
  return raw
}

function readInt(name: string, fallback: number): number {
  const raw = process.env[name]
  if (raw === undefined || raw === '') return fallback
  const n = Number(raw)
  if (!Number.isInteger(n) || n <= 0) {
    throw new ConfigError(`${name} must be a positive integer — got "${raw}"`)
  }
  return n
}

/**
 * Where the web app runs. Deployments override this; the defaults cover local
 * development and the production site so a correct deploy needs no extra env.
 */
const DEFAULT_WEB_ORIGINS = [
  'http://localhost:3000',
  'https://ottopus.xyz',
  'https://www.ottopus.xyz',
]

/** Comma-separated origins. Trailing slashes are stripped — an Origin header never has one. */
function readList(name: string, fallback: string[]): string[] {
  const raw = process.env[name]
  if (raw === undefined || raw.trim() === '') return fallback
  return raw
    .split(',')
    .map((value) => value.trim().replace(/\/$/, ''))
    .filter(Boolean)
}

/** Empty and unset mean the same thing: not configured. */
function readOptional(name: string): string | undefined {
  const raw = process.env[name]
  return raw === undefined || raw.trim() === '' ? undefined : raw
}

function readUrl(name: string): string | undefined {
  const raw = process.env[name]
  if (raw === undefined || raw === '') return undefined
  try {
    return new URL(raw).origin
  } catch {
    throw new ConfigError(`${name} must be an absolute URL — got "${raw}"`)
  }
}

export function loadConfig(): Config {
  return {
    nodeEnv: readEnum('NODE_ENV', ['development', 'production', 'test'], 'development') as NodeEnv,
    port: readInt('PORT', 8787),
    host: process.env.HOST ?? '0.0.0.0',
    publicUrl: readUrl('PUBLIC_URL'),
    gitCommit: process.env.GIT_COMMIT ?? 'dev',
    databaseUrl: readOptional('DATABASE_URL'),
    privyAppId: readOptional('PRIVY_APP_ID'),
    privyVerificationKey: readOptional('PRIVY_JWT_VERIFICATION_KEY'),
    webOrigins: readList('WEB_ORIGINS', DEFAULT_WEB_ORIGINS),
  }
}

export const config: Config = (() => {
  try {
    return loadConfig()
  } catch (err) {
    const message = err instanceof ConfigError ? err.message : String(err)
    console.error(`[config] ${message}`)
    process.exit(1)
  }
})()
