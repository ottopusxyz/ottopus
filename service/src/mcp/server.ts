import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import type { SessionUser } from '../auth/session.js'
import { chainName } from '../core/index.js'
import { NEVER_GRANTED, SCOPE_COPY, hasScope, type Scope } from '../oauth/scopes.js'
import { type StatusDeps, cancelPlan, cancelText, getPlan, getPlanText } from './plan-status.js'
import { portfolioText, summarisePortfolio, walletsText } from './readable.js'
import { type CustomDeps, customText, prepareCustom } from './custom.js'
import { type SwapDeps, prepareTrade, tradeText } from './trade.js'
import { prepareText, prepareTransfer } from './transfer.js'

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
  /** The grant row, so a plan records which agent made it. Null over stdio. */
  grantId: string | null
}

/**
 * What the tools read, handed in rather than imported.
 *
 * Functions instead of a database handle: the tools are then testable over a
 * real MCP client with nothing but fakes, and the route is the one place that
 * knows how a userId becomes a row.
 *
 * The reads a prepare_* tool needs are `SwapDeps` (which extends the
 * transfer's `PrepareDeps` with the router) and the reads get_plan and
 * cancel_plan need are `StatusDeps`, declared where those functions live
 * rather than copied here — one list per capability, and no chance of this
 * one drifting from what the pipeline actually asks for.
 */
export interface ToolDeps extends StatusDeps, SwapDeps, CustomDeps {
  findUser(userId: string): Promise<SessionUser | null>
  findAgent(clientId: string): Promise<{ clientName: string } | null>
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
  'get_plan reports what became of a plan; cancel_plan withdraws one that has not been signed.',
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
        'Balances across every linked wallet: the total, each wallet, the loose holdings that ' +
        'matter highest value first, then what sits in protocols — deposited, borrowed, staked, ' +
        'locked or claimable, per app. Amounts are exact and values are in USD. Read-only, and ' +
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

  /**
   * The first tool that builds a plan. It returns a summary, a reason and a
   * review link, and never a transaction: the calls it built are stored,
   * hashed and shown on the review page, and nothing about them comes back
   * here where an agent could act on them.
   */
  server.registerTool(
    'prepare_transfer',
    {
      title: 'Prepare a transfer',
      description:
        'Build a plan to send a token or the chain’s own currency from one of the person’s wallets. ' +
        'Picks the wallet with a stated reason unless one is given, builds the single call, decodes ' +
        'and checks it, and returns a review link. The person opens the link and signs in their own ' +
        'wallet; nothing moves until they do. Amounts are in base units (wei, or 10^decimals for a token).',
      inputSchema: {
        asset: z
          .string()
          .describe('CAIP-19 asset id, exactly as get_portfolio lists it under assetId: eip155:8453/slip44:60 for ETH on Base, eip155:8453/erc20:0x… for a token. Never guess a token contract from its symbol.'),
        amount: z
          .string()
          .regex(/^[0-9]+$/)
          .describe('Base units as a decimal string: the display amount times 10^decimals, with decimals from get_portfolio. 500 USDC (6 decimals) is "500000000".'),
        to: z
          .string()
          .describe('The recipient: an ENS name (koshik.eth), a 0x address, or a CAIP-10 (eip155:8453:0xd8da…). A name is resolved on Ethereum and used on the asset’s chain.'),
        fromAccount: z
          .string()
          .optional()
          .describe('CAIP-10 of a linked wallet to send from. Omit to let Ottopus recommend one.'),
        note: z.string().max(200).optional().describe('Why, in the person’s words. Shown on the review page.'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async (input) => {
      if (!hasScope(ctx.scopes, 'plans:write')) return denied('plans:write')
      const outcome = await prepareTransfer({ userId: ctx.userId, grantId: ctx.grantId }, deps, input)
      const body = prepareText(outcome)
      if (outcome.kind === 'invalid' || outcome.kind === 'no_wallet') return failure(body)
      if (outcome.kind === 'blocked') {
        return {
          ...text(body, { planId: outcome.planId, status: 'blocked', summary: outcome.summary, reasons: outcome.reasons }),
          isError: true,
        }
      }
      const { kind: _kind, linkExpiresAt: _link, ...structured } = outcome
      return text(body, structured)
    },
  )

  /**
   * Turning a token's name into something a prepare_* tool will accept.
   *
   * Every prepare_* tool insists on a CAIP-19 asset id and tells the agent
   * never to guess a contract from a symbol — which left it nowhere to go
   * for any token the person does not already hold, since get_portfolio only
   * lists holdings. The receiving side of a swap is exactly that case. So
   * agents went looking elsewhere, which is the one thing a tool surface
   * should make unnecessary.
   *
   * No scope: this reads a public token list and nothing about the person.
   */
  server.registerTool(
    'find_asset',
    {
      title: 'Find an asset',
      description:
        'Turn a token symbol or contract address into the CAIP-19 asset id that prepare_transfer and ' +
        'prepare_trade need, with its decimals, name and price. Use it for any token the person does ' +
        'not already hold — get_portfolio covers the ones they do. Read-only, and it reveals nothing ' +
        'about the person. A symbol can be ambiguous, so the address it resolved to comes back too: ' +
        'show it before spending anything.',
      inputSchema: {
        chain: z.string().describe('CAIP-2 chain id, e.g. eip155:8453 for Base.'),
        query: z
          .string()
          .describe('A symbol like USDC or DEGEN, or a 0x contract address. The chain’s own currency by symbol works too.'),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ chain, query }) => {
      if (!deps.tokens) {
        return failure('Token lookup is not available on this deployment — no token registry is configured.')
      }
      const found = await deps.tokens.find(chain, query)
      if (!found) {
        return failure(
          `No token matching "${query}" was found on ${chain}. Check the chain, or give the contract address instead of the symbol.`,
        )
      }
      const address = found.assetId.split(':').pop() ?? ''
      const lines = [
        `${found.name} (${found.symbol}) on ${chainName(chain)}`,
        `assetId ${found.assetId}`,
        `${found.decimals} decimals — an amount of 1 ${found.symbol} is "1${'0'.repeat(found.decimals)}" in base units`,
        ...(found.priceUsd === null ? [] : [`about $${found.priceUsd} each`]),
        found.verified
          ? 'Listed as verified by the token registry, which is a listing claim and not a safety check.'
          : 'Not marked verified by the token registry. Show the address to the person before spending anything.',
      ]
      return text(lines.join('\n'), { ...found, address })
    },
  )

  /**
   * The second tool that builds a plan, and the first that asks somebody else
   * for the calls. The route provider is untrusted: what it returns is
   * decoded and checked like anything else, and a plan whose approval does
   * not match its router call never gets a link.
   */
  server.registerTool(
    'prepare_trade',
    {
      title: 'Prepare a swap or a bridge',
      description:
        'Build a plan to turn one asset into another. Same chain is a swap, different chains a bridge — ' +
        'give the two assets and Ottopus works out which. Picks the wallet with a stated reason unless ' +
        'one is given, asks the routing provider for a route, checks the calls it returns, and returns a ' +
        'review link with the minimum received and the fees on it. Approvals are exact, never unlimited. ' +
        'The person opens the link and signs in their own wallet; nothing moves until they do. Amounts ' +
        'are in base units.',
      inputSchema: {
        from: z
          .string()
          .describe('CAIP-19 asset to spend, exactly as get_portfolio lists it under assetId. Never guess a token contract from its symbol.'),
        to: z
          .string()
          .describe('CAIP-19 asset to receive. On the same chain as `from` for a swap, on another for a bridge.'),
        amountIn: z
          .string()
          .regex(/^[0-9]+$/)
          .optional()
          .describe('Base units to spend. Give this or amountOut, not both.'),
        amountOut: z
          .string()
          .regex(/^[0-9]+$/)
          .optional()
          .describe('Base units to receive, when the person asked for an exact output. Give this or amountIn, not both.'),
        slippageBps: z
          .number()
          .int()
          .min(1)
          .max(5000)
          .optional()
          .describe('Tolerance in basis points; 50 is 0.5%. The provider’s default when omitted.'),
        fromAccount: z.string().optional().describe('CAIP-10 of a linked wallet to spend from. Omit to let Ottopus recommend one.'),
        note: z.string().max(200).optional().describe('Why, in the person’s words. Shown on the review page.'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async (input) => {
      if (!hasScope(ctx.scopes, 'plans:write')) return denied('plans:write')
      const outcome = await prepareTrade({ userId: ctx.userId, grantId: ctx.grantId }, deps, input)
      const body = tradeText(outcome)
      if (outcome.kind === 'invalid' || outcome.kind === 'no_wallet' || outcome.kind === 'no_route') {
        return failure(body)
      }
      if (outcome.kind === 'blocked') {
        return {
          ...text(body, { planId: outcome.planId, status: 'blocked', summary: outcome.summary, reasons: outcome.reasons }),
          isError: true,
        }
      }
      const { kind: _kind, linkExpiresAt: _link, ...structured } = outcome
      return text(body, structured)
    },
  )

  server.registerTool(
    'prepare_custom',
    {
      title: 'Prepare calls you authored, against a declaration',
      description:
        'The escape hatch for what prepare_transfer and prepare_trade cannot express — add liquidity, ' +
        'claim fees, stake, revoke. Use those first. Here you author the calls yourself and declare what ' +
        'they do; Ottopus decodes them, simulates them independently, and refuses the plan if the bytes ' +
        'or the simulated effect disagree with the declaration. The rules: `expectedChanges` are upper ' +
        'bounds — the simulation may show less of an asset leaving, never more, and never an asset you ' +
        'did not list. `approvals` are exact and yours — write approve(spender, amount) yourself; a ' +
        'vendor’s unlimited approval is refused. Declare from the calldata you are submitting, not from ' +
        'a vendor’s response body. Every contract must have published source. `account` is the wallet ' +
        'the calls already bind; Ottopus checks it can sign and holds what may leave, and recommends ' +
        'nothing. A refusal names what disagreed: fix the calls or the declaration and resubmit.',
      inputSchema: {
        account: z.string().describe('CAIP-10 of the linked wallet that will sign. The calls already bind it.'),
        chainId: z.string().describe('CAIP-2, e.g. eip155:8453. Every call, asset and spender must be on it.'),
        calls: z
          .array(
            z.object({
              to: z.string().describe('Contract address, bare 0x or CAIP-10.'),
              data: z.string().describe('0x calldata. "0x" for a plain value transfer.'),
              value: z.string().optional().describe('Wei, decimal or 0x hex. Omit for none.'),
            }),
          )
          .min(1)
          .max(8)
          .describe('In execution order. An approval before the call that spends it.'),
        summary: z.string().max(280).describe('What this does, in one sentence. Hashed, and shown beside what the simulation actually saw.'),
        expectedChanges: z
          .array(z.object({ asset: z.string(), maxOut: z.string().regex(/^[0-9]+$/) }))
          .optional()
          .describe('The most of each asset that may leave the account, in base units. Omit an asset and the plan is refused if it leaves.'),
        approvals: z
          .array(z.object({ asset: z.string(), spender: z.string(), amount: z.string().regex(/^[0-9]+$/) }))
          .optional()
          .describe('Every allowance the calls create: token, spender, exact amount. Never unlimited.'),
        nativeValue: z.string().regex(/^[0-9]+$/).optional().describe('Total wei of native value the calls send. Omit for none.'),
        note: z.string().max(200).optional().describe('Why, in the person’s words. Shown on the review page.'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async (input) => {
      if (!hasScope(ctx.scopes, 'plans:write')) return denied('plans:write')
      const outcome = await prepareCustom({ userId: ctx.userId, grantId: ctx.grantId }, deps, input)
      const body = customText(outcome)
      if (outcome.kind === 'invalid' || outcome.kind === 'no_wallet' || outcome.kind === 'unavailable') {
        return failure(body)
      }
      if (outcome.kind === 'blocked') {
        return {
          ...text(body, { planId: outcome.planId, status: 'blocked', summary: outcome.summary, reasons: outcome.reasons }),
          isError: true,
        }
      }
      const { kind: _kind, linkExpiresAt: _link, ...structured } = outcome
      return text(body, structured)
    },
  )

  /**
   * The two tools that follow a plan after it is built. Both answer in words
   * and status, never in calls: an agent learns whether the person signed and
   * what happened on chain, and nothing it could act on by itself.
   */
  server.registerTool(
    'get_plan',
    {
      title: 'Get a plan',
      description:
        'Where a plan this agent prepared has got to: whether the person has signed, the transaction ' +
        'hash once it is sent, and the outcome in words once the chain has decided. Poll it after ' +
        'prepare_* to report back. Never returns the calls themselves. Read-only.',
      inputSchema: {
        planId: z.string().describe('The planId a prepare_* tool returned.'),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ planId }) => {
      if (!hasScope(ctx.scopes, 'plans:read')) return denied('plans:read')
      const outcome = await getPlan({ userId: ctx.userId, grantId: ctx.grantId }, deps, planId)
      if (outcome.kind === 'not_found') return failure(getPlanText(outcome))
      return text(getPlanText(outcome), { ...outcome.view })
    },
  )

  server.registerTool(
    'cancel_plan',
    {
      title: 'Cancel a plan',
      description:
        'Withdraw a plan this agent prepared, so the review link no longer signs. Only possible before ' +
        'the person signs and sends it; afterwards the tool says so, because a sent transaction cannot ' +
        'be taken back from here.',
      inputSchema: {
        planId: z.string().describe('The planId a prepare_* tool returned.'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ planId }) => {
      if (!hasScope(ctx.scopes, 'plans:write')) return denied('plans:write')
      const outcome = await cancelPlan({ userId: ctx.userId, grantId: ctx.grantId }, deps, planId)
      if (outcome.kind === 'not_found') return failure(cancelText(outcome))
      const structured = { ...outcome.view, cancelled: outcome.kind === 'cancelled' }
      return outcome.kind === 'cancelled'
        ? text(cancelText(outcome), structured)
        : { ...text(cancelText(outcome), structured), isError: true }
    },
  )

  return server
}
