import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import type { Context } from 'hono'
import { buildServer, type ToolContext, type ToolDeps } from './server.js'

/**
 * Streamable HTTP, stateless.
 *
 * The SDK's web-standard transport takes a Request and returns a Response,
 * which is exactly Hono's shape — the Node transport wants IncomingMessage and
 * ServerResponse, and the SDK's own OAuth router is Express-bound. Neither
 * would fit here without adapting one runtime to another.
 *
 * `sessionIdGenerator: undefined` is what makes it stateless: no Mcp-Session-Id,
 * no transport object held between requests. Every request carries its bearer
 * token, and the token is what maps to a user — so there is no session to lose
 * when Railway restarts the process, and no session affinity to arrange if this
 * ever runs as more than one. It also keeps the architecture's rule honest:
 * state belongs in Supabase, not in a process Map.
 *
 * What it costs is server-initiated messages. Nothing needs them yet — plans are
 * polled, deliberately, because the MCP interface must never hold a request open
 * waiting for a person. When something does, this becomes a real decision.
 */
export async function handleMcpRequest(
  c: Context,
  ctx: ToolContext,
  deps: ToolDeps,
): Promise<Response> {
  const server = buildServer(ctx, deps)
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  })

  // Close on the way out rather than in a finally that fires before the
  // response is read: the transport owns the body stream it just returned.
  try {
    await server.connect(transport)
    return await transport.handleRequest(c.req.raw)
  } catch (err) {
    await transport.close().catch(() => {})
    throw err
  }
}
