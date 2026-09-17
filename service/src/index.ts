import { serve } from '@hono/node-server'
import { Hono } from 'hono'

const app = new Hono()

app.get('/health', (c) =>
  c.json({
    ok: true,
    service: 'ottopus',
    commit: process.env.GIT_COMMIT ?? 'dev',
  }),
)

const port = Number(process.env.PORT ?? 8787)

serve({ fetch: app.fetch, port }, ({ port }) => {
  console.log(`ottopus service listening on :${port}`)
})

export { app }
