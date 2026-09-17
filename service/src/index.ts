import { serve } from '@hono/node-server'
import { config } from './config.js'
import { handler } from './app.js'

const log = (msg: string, extra: Record<string, unknown> = {}) => {
  // stdout only — every platform captures it, and file logging works nowhere.
  console.log(JSON.stringify({ level: 'info', msg, ...extra }))
}

const server = serve({ fetch: handler, port: config.port, hostname: config.host }, (info) => {
  log('listening', { host: config.host, port: info.port, env: config.nodeEnv })
})

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
