import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import type { SessionUser } from '../auth/session.js'
import type { ArmRef, Portfolio } from '../connectors/portfolio/index.js'
import { NEVER_GRANTED, SCOPE_COPY, hasScope, type Scope } from '../oauth/scopes.js'
import type { Arm } from '../wallets/index.js'
import { portfolioText, summarisePortfolio, walletsText } from './readable.js'

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

/**
 * What the tools read, handed in rather than imported.
 *
 * Three functions instead of a database handle: the tools are then testable
 * over a real MCP client with nothing but fakes, and the route is the one place
 * that knows how a userId becomes a row. `readPortfolio` is null when no
 * balance provider is configured, so the tool can say so instead of failing.
 */
export interface ToolDeps {
  findUser(userId: string): Promise<SessionUser | null>
  findAgent(clientId: string): Promise<{ clientName: string } | null>
  listWallets(userId: string): Promise<Arm[]>
  readPortfolio: ((arms: readonly ArmRef[]) => Promise<Portfolio>) | null
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

type ToolResult = {
  content: { type: 'text'; text: string }[]
  structuredContent?: Record<string, unknown>
  isError?: boolean
}

const text = (body: string, structured?: Record<string, unknown>): ToolResult => ({
  content: [{ type: 'text', text: body }],
  ...(structured ? { structuredContent: structured } : {}),
})

const failure = (body: string): ToolResult => ({
  content: [{ type: 'text', text: body }],
  isError: true,
})

/**
 * The tools are registered whether or not the grant permits them, and refuse
 * inside the call. A tool that simply is not there tells an agent nothing; one
 * that names the missing scope tells it — and the person it reports to — what
 * to change in Settings.
 */
function denied(scope: Scope): ToolResult {
  const copy = SCOPE_COPY.find((entry) => entry.scope === scope)
  return failure(
    `This agent's grant does not include "${copy?.title ?? scope}" (${scope}). ` +
      'The person can change what it may do from Settings in Ottopus.',
  )
}

export function buildServer(ctx: ToolContext, deps: ToolDeps): McpServer {
  const server = new McpServer(SERVER_INFO, {
    capabilities: { tools: {} },
    instructions: INSTRUCTIONS,
  })

  /**
   * Who the agent is acting for, in words a person would recognise as their
   * own: the name they signed in with, the email, what this agent may do and
   * what it never may. Ids stay in the structured copy for an agent that needs
   * to correlate; they are not what gets read aloud.
   */
  server.registerTool(
    'whoami',
    {
      title: 'Who am I',
      description:
        'The person this agent is acting for, and what the grant permits. ' +
        'Read-only, and the cheapest way to confirm a connection works.',
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => {
      const [user, agent] = await Promise.all([
        deps.findUser(ctx.userId),
        deps.findAgent(ctx.clientId),
      ])
      const permissions = SCOPE_COPY.filter((entry) => hasScope(ctx.scopes, entry.scope))
      const who = user?.name
        ? user.email
          ? `${user.name} (${user.email})`
          : user.name
        : (user?.email ?? 'an Ottopus account with no name or email on file')
      const agentName = agent?.clientName ?? 'This agent'

      const lines = [
        `Signed in as ${who}.`,
        permissions.length > 0
          ? `${agentName} may: ${permissions.map((entry) => entry.title.toLowerCase()).join('; ')}.`
          : `${agentName} has a grant with no permissions — it can only call whoami.`,
        // The consent screen's own row, minus its "Never granted." lead-in,
        // which this sentence has already said.
        `It can never ${NEVER_GRANTED.title.toLowerCase()} — ${NEVER_GRANTED.detail.replace(/^Never granted\.\s*/, '')}`,
      ]

      return text(lines.join('\n'), {
        user: { name: user?.name ?? null, email: user?.email ?? null, id: ctx.userId },
        agent: { name: agent?.clientName ?? null, clientId: ctx.clientId },
        permissions: permissions.map(({ scope, title, detail }) => ({ scope, title, detail })),
        neverGranted: NEVER_GRANTED.title,
      })
    },
  )

  server.registerTool(
    'list_wallets',
    {
      title: 'List wallets',
      description:
        "The wallets this person has linked to Ottopus, with each one's address, the software " +
        'it lives in, and whether it can sign. Watch-only wallets are visible but can never sign. ' +
        'Read-only.',
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => {
      if (!hasScope(ctx.scopes, 'wallets:read')) return denied('wallets:read')
      const arms = await deps.listWallets(ctx.userId)
      return text(walletsText(arms), {
        wallets: arms.map((arm) => ({
          id: arm.id,
          name: arm.label ?? null,
          walletType: arm.walletType,
          namespace: arm.namespace,
          address: arm.address,
          watchOnly: arm.isWatchOnly,
          canSign: !arm.isWatchOnly && arm.provedAt !== null,
        })),
      })
    },
  )

  server.registerTool(
    'get_portfolio',
    {
      title: 'Get portfolio',
      description:
        'Balances across every linked wallet: the total, each wallet, and the holdings that ' +
        'matter, highest value first. Amounts are exact and values are in USD. Read-only, and ' +
        'never a reason to move anything.',
      inputSchema: {
        limit: z
          .number()
          .int()
          .min(1)
          .max(100)
          .optional()
          .describe('How many holdings to list, highest value first. Default 20.'),
        walletId: z
          .string()
          .optional()
          .describe('Only this wallet, by the id list_wallets gave. Default: every linked wallet.'),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ limit, walletId }) => {
      if (!hasScope(ctx.scopes, 'wallets:read')) return denied('wallets:read')
      if (!deps.readPortfolio) {
        return failure(
          'Balances are not available on this deployment — no portfolio provider is configured. ' +
            'The wallets themselves are still listed by list_wallets.',
        )
      }
      const linked = await deps.listWallets(ctx.userId)
      if (linked.length === 0) return text(walletsText(linked), { total: 0, wallets: [], assets: [] })

      // Narrowed here rather than in the provider call alone: an id from another
      // account, or a stale one, must read as "no such wallet", never as an
      // empty portfolio that looks like an honest zero.
      const arms = walletId ? linked.filter((arm) => arm.id === walletId) : linked
      if (arms.length === 0) {
        return failure(`No linked wallet has the id ${walletId}. list_wallets gives the current ids.`)
      }

      const portfolio = await deps.readPortfolio(
        arms.map((arm) => ({ walletId: arm.id, namespace: arm.namespace, address: arm.address })),
      )
      const summary = summarisePortfolio(portfolio, arms, limit ?? 20)
      return text(portfolioText(summary), { ...summary })
    },
  )

  return server
}
