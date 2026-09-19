import { serve } from '@hono/node-server'
import { config } from './config.js'
import { handler } from './app.js'
import { getDb } from './db/client.js'
import { ReceiptWatcher, httpReceiptReader } from './jobs/receipts.js'
import { purgeExpired } from './oauth/index.js'
import { listSubmitted, transition } from './plans/index.js'

const log = (msg: string, extra: Record<string, unknown> = {}) => {
  // stdout only — every platform captures it, and file logging works nowhere.
  console.log(JSON.stringify({ level: 'info', msg, ...extra }))
}

const server = serve({ fetch: handler, port: config.port, hostname: config.host }, (info) => {
  // The advertised identity is in the first line of the deploy log on purpose.
  // config.ts refuses to boot on a loopback mcpUrl in production, but that
  // guard needs NODE_ENV to be set, and a deploy that sets nothing at all would
  // slip past it — so the value it would have caught is printed where anyone
  // watching a deploy can see it. Every OAuth endpoint is built from mcpUrl.
  log('listening', {
    host: config.host,
    port: info.port,
    env: config.nodeEnv,
    mcpUrl: config.mcpUrl,
    webUrl: config.webUrl,
  })
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
const RECEIPT_EVERY_MS = 10_000

if (config.databaseUrl) {
  const db = getDb(config.databaseUrl)
  const sweep = () =>
    void purgeExpired(db).catch((err: unknown) =>
      console.error(JSON.stringify({ level: 'error', msg: 'purge failed', err: String(err) })),
    )
  sweep()
  setInterval(sweep, PURGE_EVERY_MS).unref()

  /**
   * Submitted plans reach confirmed or failed here when nobody is holding the
   * review page open. One tick every ten seconds reads only the plans that
   * are due; each plan backs off on its own, so a stuck transaction is a
   * read every few minutes, not every tick. Ticks never overlap: a slow chain
   * delays the next tick rather than stacking a second one on top.
   */
  const watcher = new ReceiptWatcher({
    listSubmitted: () => listSubmitted(db),
    transition: (input) => transition(db, input),
    reader: httpReceiptReader({ rpcUrlTemplate: config.rpcUrlTemplate }),
    log: (msg, extra) => log(msg, extra),
  })
  let watching = false
  const watch = async () => {
    if (watching) return
    watching = true
    try {
      const report = await watcher.tick()
      if (report.checked > 0) log('receipts', { ...report })
    } catch (err) {
      console.error(JSON.stringify({ level: 'error', msg: 'receipt tick failed', err: String(err) }))
    } finally {
      watching = false
    }
  }
  void watch()
  setInterval(() => void watch(), RECEIPT_EVERY_MS).unref()
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
