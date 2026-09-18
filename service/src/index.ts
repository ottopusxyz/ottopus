import { serve } from '@hono/node-server'
import { config } from './config.js'
import { handler } from './app.js'
import { getDb } from './db/client.js'
import { purgeExpired } from './oauth/index.js'

const log = (msg: string, extra: Record<string, unknown> = {}) => {
  // stdout only — every platform captures it, and file logging works nowhere.
  console.log(JSON.stringify({ level: 'info', msg, ...extra }))
}

const server = serve({ fetch: handler, port: config.port, hostname: config.host }, (info) => {
  log('listening', { host: config.host, port: info.port, env: config.nodeEnv })
})

/**
 * Authorization codes live a minute and parked consent requests ten, so both
 * tables accumulate rows that can never be used again. Swept hourly rather than
 * on a request, because nobody's tool call should pay for housekeeping.
 *
 * Unref'd, so a sweep pending at shutdown does not hold the process open. The
 * next boot picks up whatever this one missed — nothing here is urgent, and
 * everything it deletes was already refused by the queries above.
 */
const PURGE_EVERY_MS = 60 * 60 * 1000

if (config.databaseUrl) {
  const db = getDb(config.databaseUrl)
  const sweep = () =>
    void purgeExpired(db).catch((err: unknown) =>
      console.error(JSON.stringify({ level: 'error', msg: 'purge failed', err: String(err) })),
    )
  sweep()
  setInterval(sweep, PURGE_EVERY_MS).unref()
}

/**
 * Every platform sends SIGTERM before replacing a container. Without this the
 * process dies mid-request — and this service holds long-lived MCP streams, so
 * that is a dropped agent session rather than a retryable GET.
 */
let shuttingDown = false

function shutdown(signal: NodeJS.Signals): void {
  if (shuttingDown) return
  shuttingDown = true
  log('shutting down', { signal })

  const forced = setTimeout(() => {
    console.error(JSON.stringify({ level: 'error', msg: 'forced exit, connections still open' }))
    process.exit(1)
  }, 10_000)
  forced.unref()

  server.close((err) => {
    clearTimeout(forced)
    if (err) {
      console.error(JSON.stringify({ level: 'error', msg: 'shutdown failed', err: String(err) }))
      process.exit(1)
    }
    log('shutdown complete')
    process.exit(0)
  })
}

process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)
