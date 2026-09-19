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
  /**
   * The canonical resource identifier for the MCP server — RFC 8707's
   * `resource`, and the `resource` field of our protected-resource metadata.
   *
   * Exactly one string, even though the surface answers on two shapes
   * (mcp.ottopus.xyz and /mcp). Audience binding compares tokens against this
   * value, so a second spelling would be a second audience, and a token minted
   * for one would be rejected at the other.
   */
  mcpUrl: string
  /**
   * Where the web app lives. The authorize endpoint redirects a browser to its
   * consent route, so this is a single origin rather than the allow-list.
   */
  webUrl: string
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
  /**
   * Zerion, the portfolio provider. A real secret, unlike the Privy values —
   * it is an HTTP Basic credential, so it never leaves the service and the
   * browser never sees it.
   */
  zerionApiKey: string | undefined
  /** Overridable so a test or a mock can stand in for the real API. */
  zerionApiUrl: string | undefined
  /**
   * One RPC provider for every chain: a URL with `{chainId}` in it, the EVM id
   * substituted per chain. Unset means viem's public endpoints, which are fine
   * for a laptop and rate-limited for a demo.
   */
  rpcUrlTemplate: string | undefined
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

/**
 * An absolute URL kept whole — path included, trailing slash removed.
 *
 * Distinct from readUrl, which keeps only the origin. A resource identifier may
 * carry a path (http://localhost:8787/mcp), and RFC 8707 compares it as a
 * string, so trimming it to the origin would silently change the audience.
 */
function readResourceUrl(name: string, fallback: string): string {
  const raw = process.env[name]
  if (raw === undefined || raw.trim() === '') return fallback
  let url: URL
  try {
    url = new URL(raw.trim())
  } catch {
    throw new ConfigError(`${name} must be an absolute URL — got "${raw}"`)
  }
  if (url.hash || url.search) {
    throw new ConfigError(`${name} must have no query or fragment — got "${raw}"`)
  }
  return url.toString().replace(/\/$/, '')
}

/**
 * Addresses that only ever mean "this machine".
 *
 * `URL.hostname` normalises an IPv6 literal to bracketless form, which is why
 * `::1` appears without them.
 */
const LOOPBACK = new Set(['localhost', '127.0.0.1', '::1', '0.0.0.0'])

/**
 * A loopback identity is right on a laptop and a broken deploy anywhere else.
 *
 * This is not a style rule. `mcpUrl` is the issuer, every OAuth endpoint in the
 * discovery documents is built from it, and RFC 8707 compares tokens against it
 * as a string — so a production service that falls back to
 * http://localhost:8080/mcp publishes a registration endpoint no client can
 * reach and then rejects its own real address as the wrong audience. Both
 * failures are silent: health is green, the web app is fine, and only an
 * external agent ever finds out.
 *
 * Deployed once with neither PUBLIC_URL nor MCP_URL set, which is what this
 * exists to stop. The host is not guessed from the request — Host is
 * attacker-controlled and the issuer must be one fixed string — so the only
 * safe move is to refuse to start and say which variable is missing.
 */
function assertNotLoopback(nodeEnv: NodeEnv, values: Record<string, string>): void {
  if (nodeEnv !== 'production') return
  for (const [setting, value] of Object.entries(values)) {
    if (LOOPBACK.has(new URL(value).hostname)) {
      throw new ConfigError(
        `${setting} resolved to ${value}, which is only reachable from inside the container. ` +
          `Set ${setting} to the public URL this service answers on.`,
      )
    }
  }
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

/** A provider template has to have somewhere to put the chain id. */
function readRpcTemplate(name: string): string | undefined {
  const raw = readOptional(name)
  if (raw === undefined) return undefined
  if (!raw.includes('{chainId}')) {
    throw new ConfigError(`${name} must contain {chainId}, e.g. https://rpc.example/v1/{chainId}/KEY`)
  }
  return raw
}

export function loadConfig(): Config {
  // Read first: the MCP and web URLs default off them.
  const port = readInt('PORT', 8787)
  const publicUrl = readUrl('PUBLIC_URL')
  const webOrigins = readList('WEB_ORIGINS', DEFAULT_WEB_ORIGINS)
  const nodeEnv = readEnum(
    'NODE_ENV',
    ['development', 'production', 'test'],
    'development',
  ) as NodeEnv

  const mcpUrl = readResourceUrl(
    'MCP_URL',
    publicUrl ? `${publicUrl}/mcp` : `http://localhost:${port}/mcp`,
  )
  // The first default origin is localhost, so an unset WEB_URL in production
  // sends the consent redirect to the deployer's own laptop.
  const webUrl = readResourceUrl('WEB_URL', webOrigins[0] ?? DEFAULT_WEB_ORIGINS[0]!)
  assertNotLoopback(nodeEnv, { MCP_URL: mcpUrl, WEB_URL: webUrl })

  return {
    nodeEnv,
    port,
    host: process.env.HOST ?? '0.0.0.0',
    publicUrl,
    mcpUrl,
    webUrl,
    gitCommit: process.env.GIT_COMMIT ?? 'dev',
    databaseUrl: readOptional('DATABASE_URL'),
    privyAppId: readOptional('PRIVY_APP_ID'),
    privyVerificationKey: readOptional('PRIVY_JWT_VERIFICATION_KEY'),
    webOrigins,
    zerionApiKey: readOptional('ZERION_API_KEY'),
    zerionApiUrl: readOptional('ZERION_API_URL'),
    rpcUrlTemplate: readRpcTemplate('RPC_URL_TEMPLATE'),
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
