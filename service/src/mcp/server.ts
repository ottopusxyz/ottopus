import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { PLAN_STATUSES } from '../core/index.js'

/**
 * The tool surface.
 *
 * One server object per request, because the transport is stateless — see
 * transport.ts for why. Building it is cheap: registering tools is bookkeeping
 * in memory, and the alternative is a shared instance whose per-request
 * identity would have to be threaded through every handler anyway.
 *
 * Nothing here signs or broadcasts, and nothing here ever will. The plan is
 * explicit that `sign_message`, `sign_transaction` and `send_raw_transaction`
 * are never exposed — tool calls create plans, not transactions.
 */

export interface ToolContext {
  /** The Ottopus user the grant belongs to. */
  userId: string
  /** The agent holding the grant. */
  clientId: string
  /** What that grant actually carries. */
  scopes: readonly string[]
}

export const SERVER_INFO = {
  name: 'ottopus',
  version: '0.1.0',
  title: 'Ottopus',
} as const

/**
 * Instructions ride along with the server's identity, so a host can tell its
 * model what this server is for before any tool is called. Short on purpose:
 * this is a system prompt someone else pays for.
 */
const INSTRUCTIONS = [
  'Ottopus prepares wallet transactions for human review. It never signs and never broadcasts.',
  'Every prepare_* tool returns a plan and a review URL. The user opens that link, checks the',
  'decoded calls and the simulation, and signs in their own wallet. Nothing you do here moves funds.',
].join(' ')

export function buildServer(ctx: ToolContext): McpServer {
  const server = new McpServer(SERVER_INFO, {
    capabilities: { tools: {} },
    instructions: INSTRUCTIONS,
  })

  /**
   * The one tool this issue ships, and it is deliberately boring.
   *
   * It answers "is the grant real, and did it reach core without leaving the
   * process" — the two things #10 is actually about. `list_wallets` and
   * `get_portfolio` are #13 and land next; putting them here early would mean
   * this issue was never testable on its own.
   */
  server.registerTool(
    'whoami',
    {
      title: 'Who am I',
      description:
        'The Ottopus account this agent is acting for, and what the grant permits. ' +
        'Read-only, and the cheapest way to confirm a connection works.',
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => ({
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              userId: ctx.userId,
              clientId: ctx.clientId,
              scopes: [...ctx.scopes],
              // Read straight out of core, in this process. If the two ever
              // stop agreeing, the plan format has drifted and every review
              // page is wrong — better to see it on a hello-world call.
              planStatuses: [...PLAN_STATUSES],
            },
            null,
            2,
          ),
        },
      ],
    }),
  )

  return server
}
