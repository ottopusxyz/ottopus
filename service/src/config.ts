/**
 * Environment config, parsed and validated once at boot.
 *
 * Every host we may run on (Railway, Render, Fly, a plain EC2 box) injects
 * config through the environment and nothing else. Read env vars here, never
 * scattered through the codebase, and fail loudly at startup rather than at the
 * first request that needs a missing value.
 */

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
