import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import type { SessionUser } from '../auth/session.js'
import { EVM_ADDRESS_RE, chainName } from '../core/index.js'
import type { StockInfo } from '../connectors/tokens/index.js'
import { stockFactsStale, stockMarket, stockMarketWords, stockPremium, stockStaleReason } from '../verify/index.js'
import { NEVER_GRANTED, SCOPE_COPY, hasScope, type Scope } from '../oauth/scopes.js'
import { type StatusDeps, cancelPlan, cancelText, getPlan, getPlanText } from './plan-status.js'
import { portfolioText, resolveWallet, summarisePortfolio, usd, walletsText } from './readable.js'
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
        "The wallets this person has linked to Ottopus, with each one's full address, id, the " +
        'software it lives in, and whether it can sign. Any of the name, id, address or list ' +
        'number names a wallet to the other tools. Watch-only wallets are visible but can never ' +
        'sign. Read-only.',
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
        wallet: z
          .string()
          .optional()
          .describe('Only this wallet: its name ("Safe", "Main"), its id, its 0x address or CAIP-10, or its number in list_wallets. Default: every linked wallet.'),
        walletId: z.string().optional().describe('The same as wallet; kept for older callers.'),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ limit, wallet, walletId }) => {
      if (!hasScope(ctx.scopes, 'wallets:read')) return denied('wallets:read')
      if (!deps.readPortfolio) {
        return failure(
          'Balances are not available on this deployment — no portfolio provider is configured. ' +
            'The wallets themselves are still listed by list_wallets.',
        )
      }
      const linked = await deps.listWallets(ctx.userId)
      if (linked.length === 0) return text(walletsText(linked), { total: 0, wallets: [], assets: [] })

      // Narrowed here rather than in the provider call alone: a wallet from
      // another account, or a stale one, must read as "no such wallet", never
      // as an empty portfolio that looks like an honest zero.
      let arms = linked
      const named = wallet ?? walletId
      if (named) {
        const match = resolveWallet(linked, named)
        if (!match.ok) return failure(`No linked wallet matches ${named}: ${match.reason}`)
        arms = [match.arm]
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
          .describe('The linked wallet to send from: its name ("Safe"), id, 0x address, CAIP-10, or number in list_wallets. Omit to let Ottopus recommend one.'),
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
        'show it before spending anything. A tokenized stock is resolved from stock data, so a bare ' +
        'ticker like NVDA with several providers on the chain is refused with the choice listed; a ' +
        'provider’s own symbol (NVDAB, NVDAon) or the address names one. To see every provider’s token ' +
        'for a stock with its prices and market state, call find_stock.',
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
        const variants = deps.stocks ? await deps.stocks.variants(chain, query) : []
        // The stock data could not be read, and the composite will not guess a
        // symbol past it. That is a retry, not a missing token: saying "not
        // found" would send the agent off to find the contract somewhere else.
        if (variants === null && !EVM_ADDRESS_RE.test(query.trim())) {
          return failure(
            `Could not look up "${query}" on ${chainName(chain)} right now: the tokenized-stock data did not answer, ` +
              'and a symbol is not resolved without it in case it names a stock. Try again in a minute, or give the contract address.',
          )
        }
        // A bare stock ticker on a chain with more than one provider. Nobody
        // picks: the choice is shown, and the agent asks the person.
        if (variants && variants.length > 1) {
          const shown = variants.slice(0, 6)
          const more = variants.length - shown.length
          return failure(
            [
              `"${query}" names ${variants.length} tokens on ${chainName(chain)}, from different providers:`,
              ...shown.map((v) => `  ${v.symbol} (${v.stock.platformId}) ${v.assetId}`),
              ...(more > 0 ? [`  and ${more} more`] : []),
              'Ask which provider the person means, then call find_asset with that token symbol or its address.',
            ].join('\n'),
          )
        }
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
   * The question find_asset cannot answer: which tokens *are* this stock,
   * and what state is each in. A ticker on a chain is several contracts from
   * several providers, at different prices and share ratios, and the person
   * picks one before anything is prepared. So the answer is every variant,
   * with the figures a person would compare — the token's price beside the
   * share's, the gap between them, whether the market is open — and the
   * address beneath each, since that is what a prepare_* tool takes.
   *
   * The premium and the market state are the same readings verify makes on
   * a plan, at this call's clock, so what the agent shows before preparing
   * is what the review page will say after.
   *
   * No scope: this reads public stock data and nothing about the person.
   */
  server.registerTool(
    'find_stock',
    {
      title: 'Find a stock’s tokens',
      description:
        'List every tokenized version of a stock on a chain, from every provider, with the CAIP-19 asset ' +
        'id prepare_trade needs for each. Query by ticker (NVDA), company name (Nvidia), or a provider’s ' +
        'own token symbol (NVDAB, NVDAon). Per token: the provider, decimals, shares per token, the ' +
        'token’s price, the underlying share’s reference price, the gap between them as a signed ' +
        'percentage, and whether the market is open, with the next open and close. A bare ticker with ' +
        'several providers means ask the person which one they want; a suffixed symbol (…B for bStock, ' +
        '…on for Ondo) names one. A reading older than five minutes is marked stale, with when it was ' +
        'read; prepare_trade blocks on stale facts until they refresh. Read-only, and it reveals nothing ' +
        'about the person. Show the address before spending anything.',
      inputSchema: {
        chain: z.string().describe('CAIP-2 chain id, e.g. eip155:56 for BNB Chain.'),
        query: z.string().describe('A ticker like NVDA, a company name like Nvidia, a provider’s token symbol like NVDAB, or a 0x contract address.'),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ chain, query }) => {
      if (!deps.stocks) {
        return failure('Stock lookup is not available on this deployment — no tokenized-stock data is configured.')
      }
      const variants = await deps.stocks.variants(chain, query)
      // Null is the registry saying it could not answer, which is not the
      // same as "not a stock": the agent should try again, not go looking
      // for the contract somewhere else.
      if (variants === null) {
        return failure(
          `Could not look up "${query}" on ${chainName(chain)} right now: the tokenized-stock data did not answer. ` +
            'Try again in a minute.',
        )
      }
      if (variants.length === 0) {
        return failure(
          `No tokenized stock matching "${query}" was found on ${chainName(chain)}. Check the ticker and the chain; ` +
            'for a token that is not a stock, call find_asset.',
        )
      }
      const now = new Date()
      const rows = variants.map((info) => stockVariant(info, now))
      const first = variants[0]!.stock
      const heading =
        variants.length === 1
          ? `${first.companyName} (${first.ticker}) has one token on ${chainName(chain)}:`
          : `${first.companyName} (${first.ticker}) has ${variants.length} tokens on ${chainName(chain)}, from different providers:`
      const lines = [heading, ...rows.flatMap((row) => [row.line, `  assetId ${row.assetId}`])]
      if (variants.length > 1) {
        lines.push('Ask which provider the person means before preparing anything; each is a different contract.')
      }
      return text(lines.join('\n'), {
        ticker: first.ticker,
        companyName: first.companyName,
        chain,
        variants: rows.map(({ line: _line, ...row }) => row),
      })
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
        fromAccount: z.string().optional().describe('The linked wallet to spend from: its name ("Safe"), id, 0x address, CAIP-10, or number in list_wallets. Omit to let Ottopus recommend one.'),
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
        account: z.string().describe('The linked wallet that will sign — its name, id, 0x address or CAIP-10. The calls already bind it.'),
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

/**
 * One stock token as a line and as a record.
 *
 * "NVDAB (bstock) $224.30, 0.08% over reference, market open (regular hours)".
 * The premium is signed and to two places because a tenth of a percent is the
 * order the gaps come in; the market words are verify's, so the agent and
 * the review page never disagree about whether it is open.
 *
 * The clock is verify's too. The registry serves its last answer through a
 * vendor outage, and a plan on facts older than `STOCK_FACTS_MAX_AGE_MS`
 * blocks; so a reading that old is said to be stale here, with when it was
 * read, rather than passed off as the price and the market now. The premium
 * goes with it, as it does in verify: a reference from before an outage
 * measures nothing. The last-read figures stay, marked, because "it was
 * $225 an hour ago" is still worth more to the agent than nothing.
 *
 * A stale row is labelled by the calendar at its read time, not at this
 * clock. `stockMarket` lets the calendar name the hour when the vendor says
 * open and no more, and Friday's reading looked at on Saturday would
 * otherwise be called closed, which is not what was read.
 */
function stockVariant(info: StockInfo, now: Date) {
  const { stock } = info
  const stale = stockFactsStale(info, now)
  const premium = stale ? null : stockPremium(info)
  const readAt = new Date(Date.parse(stock.asOf))
  const market = stockMarket(info, stale && Number.isFinite(readAt.getTime()) ? readAt : now)
  const price = info.priceUsd === null ? 'price unavailable' : usd(info.priceUsd)
  const gap =
    premium === null
      ? stock.referencePriceUsd === null
        ? 'no reference price'
        : `reference ${usd(stock.referencePriceUsd)}`
      : `${premiumWords(premium)} reference`
  const state =
    market.state === 'halted'
      ? `halted${market.reason ? ` (${market.reason})` : ''}`
      : market.state === 'closed'
        ? `market closed${market.nextOpenAt ? `, opens ${market.nextOpenAt}` : ''}`
        : `market open (${stockMarketWords(market.state)})`
  const ratio = Math.abs(stock.tokenToShareRatio - 1) >= 0.00005 ? `, ${stock.tokenToShareRatio.toFixed(4)} shares per token` : ''
  // A stale line says what was read, without a next bell that may have rung.
  const then =
    market.state === 'halted'
      ? `halted${market.reason ? ` (${market.reason})` : ''}`
      : market.state === 'closed'
        ? 'market closed'
        : `market open (${stockMarketWords(market.state)})`
  const staleReason = stale ? stockStaleReason(info, now) : null
  const line = stale
    ? `${info.symbol} (${stock.platformId}) stale — was ${price}, ${then}${ratio}. ${staleReason} prepare_trade blocks on it until then.`
    : `${info.symbol} (${stock.platformId}) ${price}, ${gap}, ${state}${ratio}`
  return {
    line,
    provider: stock.platformId,
    symbol: info.symbol,
    name: info.name,
    assetId: info.assetId,
    address: info.assetId.split(':').pop() ?? '',
    decimals: info.decimals,
    tokenToShareRatio: stock.tokenToShareRatio,
    tokenPriceUsd: info.priceUsd,
    referencePriceUsd: stock.referencePriceUsd,
    premiumPercent: premium === null ? null : Number((premium * 100).toFixed(2)),
    status: {
      state: market.state,
      open: market.state !== 'closed' && market.state !== 'halted',
      reason: market.reason,
      reasonMessage: market.note,
      nextOpenAt: market.nextOpenAt,
      nextCloseAt: market.nextCloseAt,
    },
    asOf: stock.asOf,
    stale,
    staleReason,
  }
}

/** "+0.08% over" / "−1.40% under" / "at" — signed, two places, never bare. */
function premiumWords(premium: number): string {
  const pct = Math.abs(premium * 100)
  if (pct < 0.005) return 'at'
  return `${premium > 0 ? '+' : '−'}${pct.toFixed(2)}% ${premium > 0 ? 'over' : 'under'}`
}
