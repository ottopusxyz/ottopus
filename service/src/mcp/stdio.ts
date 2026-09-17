import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { SCOPES } from '../oauth/scopes.js'
import { buildServer } from './server.js'

/**
 * The stdio variant, for local development. Same tool code, no OAuth.
 *
 * The MCP spec is explicit that stdio servers should not run the authorization
 * flow and should take credentials from the environment instead — there is no
 * browser to redirect and no origin to bind a grant to. So this trusts whoever
 * launched the process, which is the same trust every stdio server operates
 * under: the client already had to be able to spawn it.
 *
 * Remote is still the real surface. Web agent hosts cannot spawn a local
 * process at all, so this exists to shorten the loop while writing tools, never
 * as the way anybody connects.
 *
 * Anything written to stdout that is not a protocol message corrupts the
 * stream, so diagnostics go to stderr. That is not a style preference here.
 */
async function main(): Promise<void> {
  const userId = process.env.OTTOPUS_USER_ID
  if (!userId) {
    console.error('[mcp:stdio] set OTTOPUS_USER_ID to the account these tools should act for')
    process.exit(1)
  }

  const server = buildServer({
    userId,
    clientId: 'stdio',
    // No grant to narrow, because there was no consent screen to narrow it.
    scopes: [...SCOPES],
  })

  await server.connect(new StdioServerTransport())
  console.error('[mcp:stdio] ready')
}

main().catch((err: unknown) => {
  console.error('[mcp:stdio]', err)
  process.exit(1)
})
