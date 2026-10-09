import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import type { SessionUser } from '../auth/session.js'
import { EVM_ADDRESS_RE, chainName } from '../core/index.js'
import type { StockInfo } from '../connectors/tokens/index.js'
import { stockFactsStale, stockMarket, stockMarketWords, stockPremium, stockStaleReason } from '../verify/index.js'
import { NEVER_GRANTED, SCOPE_COPY, hasScope, type Scope } from '../oauth/scopes.js'
import {
  type StatusDeps,
  cancelPlan,
  cancelText,
  getPlan,
  getPlanText,
  readStatus,
  reportExecution,
  reportText,
} from './plan-status.js'
import { capabilitiesOf } from '../wallets/index.js'
import { PLAN_CARD_META, PLAN_STATUS_META, registerPlanCard } from './plan-card.js'
import { portfolioText, resolveWallet, summarisePortfolio, usd, walletsText } from './readable.js'
import { type CustomDeps, customText, prepareCustom } from './custom.js'
import { type LinkDeps, finishLink, finishText, linkToolWords, startLink, startText } from './link.js'
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
 * transfer's `PrepareDeps` with the router) and what get_plan, cancel_plan
 * and report_execution need is `StatusDeps`, declared where those functions live
 * rather than copied here — one list per capability, and no chance of this
 * one drifting from what the pipeline actually asks for.
 */
export interface ToolDeps extends StatusDeps, SwapDeps, CustomDeps, LinkDeps {
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
  'The one exception is a wallet this agent operates itself through a vendor CLI: the person approves',
  'instead of signing, get_plan then returns that plan’s calls for the agent’s own wallet to send, and',
  'report_execution records the transaction hash. Ottopus still does not sign or send them.',
  'When the person names no wallet, Ottopus prefers such an agent-operated wallet over one they sign',
  'with, as long as it can pay; the reply says which wallet it chose and why.',
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
      (scope === 'wallets:write'
        ? 'It is never granted by default: the person switches it on at the consent screen when the ' +
          'agent connects. Reconnect this agent to Ottopus and turn that permission on before allowing access.'
        : 'The person can change what it may do from Settings in Ottopus.'),
  )
}

export function buildServer(ctx: ToolContext, deps: ToolDeps): McpServer {
  const server = new McpServer(SERVER_INFO, {
    capabilities: { tools: {} },
    instructions: INSTRUCTIONS,
  })
  registerPlanCard(server)

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
          agentProvider: arm.agentProvider,
          watchOnly: arm.isWatchOnly,
          ...capabilitiesOf(arm),
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
      _meta: PLAN_CARD_META,
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
      // A stock's market state is find_stock's reading, not the vendor's raw
      // flag: the flag says "open" through a weekend, and two tools that
      // disagree about a Saturday leave the agent believing the wrong one.
      const stock = isStock(found) ? stockStatus(found, new Date()) : null
      const lines = [
        `${found.name} (${found.symbol}) on ${chainName(chain)}`,
        `assetId ${found.assetId}`,
        `${found.decimals} decimals — an amount of 1 ${found.symbol} is "1${'0'.repeat(found.decimals)}" in base units`,
        ...(found.priceUsd === null ? [] : [`about $${found.priceUsd} each`]),
        ...(stock ? [`A tokenized stock: ${stock.stale ? `${stock.then} when last read, which is stale` : stock.words}. find_stock has its reference price and premium.`] : []),
        found.verified
          ? 'Listed as verified by the token registry, which is a listing claim and not a safety check.'
          : 'Not marked verified by the token registry. Show the address to the person before spending anything.',
      ]
      return text(lines.join('\n'), {
        ...found,
        address,
        ...(isStock(found) && stock ? { stock: { ...found.stock, status: stock.status, stale: stock.stale } } : {}),
      })
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
        'several providers: pick the one that is open, has a reference price and sits closest to it when ' +
        'that gap is under 1% in the direction that costs the person, and say which and why; ask the person when none is open with a reference, ' +
        'the best gap is over 1%, or two are within a tenth of a percent. A suffixed symbol (…B for bStock, ' +
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
        lines.push(
          'Each is a different contract. Pick the open one closest to its reference when that gap is under 1% in the ' +
            'direction that costs the person and say why; ask which provider the person means before preparing anything ' +
            'when none is open with a reference, the best gap is over 1%, or two are within a tenth of a percent.',
        )
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
      _meta: PLAN_CARD_META,
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
      _meta: PLAN_CARD_META,
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
   * The tools that follow a plan after it is built. They answer in words and
   * status: an agent learns whether the person signed and what happened on
   * chain, and nothing it could act on by itself — except for a plan on a
   * wallet the agent itself operates, once that plan is approved. Then, and
   * only then, get_plan carries the calls, and report_execution takes back
   * the hash of what the agent's wallet sent.
   */
  server.registerTool(
    'get_plan',
    {
      title: 'Get a plan',
      description:
        'Where a plan this agent prepared has got to: whether the person has signed or approved, the ' +
        'transaction hash once it is sent, and the outcome in words once the chain has decided. Poll it ' +
        'after prepare_* to report back. It never returns the calls of a plan a person signs in their own ' +
        'wallet. For a plan on a wallet this agent operates, once the person has approved it, it returns ' +
        'the calls, the plan hash and how to send them with that wallet’s CLI; send them as given, then ' +
        'call report_execution. It changes nothing about a plan except that the first read to return calls is ' +
        'recorded, after which the plan can no longer be cancelled; reading again is safe and repeats them. ' +
        'Do not ask for the calls before the status is approved, and never carry out the plan with the ' +
        'wallet CLI’s own swap or send commands instead: the calls are the trade.',
      inputSchema: {
        planId: z.string().describe('The planId a prepare_* tool returned.'),
      },
      _meta: PLAN_CARD_META,
      // Not read-only: handing out the calls writes an event and closes cancel.
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ planId }) => {
      if (!hasScope(ctx.scopes, 'plans:read')) return denied('plans:read')
      const outcome = await getPlan({ userId: ctx.userId, grantId: ctx.grantId }, deps, planId)
      if (outcome.kind === 'not_found') return failure(getPlanText(outcome))
      if (!outcome.handoff) return text(getPlanText(outcome), { ...outcome.view })
      const { calls, planHash, execute, from, handedOffAt, first } = outcome.handoff
      return text(getPlanText(outcome), { ...outcome.view, calls, planHash, execute, from, handedOffAt, alreadyHandedOff: !first })
    },
  )

  /**
   * What the plan card polls to follow a plan to its end. It cannot be
   * get_plan: on an approved agentic plan, get_plan's first read hands out
   * the calls and closes cancel, and a card refreshing in the background must
   * never do that. This one is only handed the store's read.
   *
   * Hidden from the model by `visibility: ["app"]`, but that is the host's
   * courtesy, not a check: anyone holding the grant can call it, so it asks
   * for plans:read and sees only this grant's plans, exactly like get_plan.
   */
  server.registerTool(
    'plan_status',
    {
      title: 'Plan status',
      description:
        'The status of a plan this agent prepared, for the plan card to stay current. Read-only: it never ' +
        'returns calls and never changes the plan. Agents use get_plan.',
      inputSchema: {
        planId: z.string().describe('The planId a prepare_* tool returned.'),
      },
      _meta: PLAN_STATUS_META,
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    async ({ planId }) => {
      if (!hasScope(ctx.scopes, 'plans:read')) return denied('plans:read')
      const outcome = await readStatus({ userId: ctx.userId, grantId: ctx.grantId }, deps, planId)
      if (outcome.kind === 'not_found') return failure(getPlanText(outcome))
      const { view } = outcome
      return text(`Status: ${view.status}. ${view.outcome}`, { ...view })
    },
  )

  server.registerTool(
    'report_execution',
    {
      title: 'Report an execution',
      description:
        'Tell Ottopus that this agent’s own wallet sent an approved plan, and with which transaction. ' +
        'Only for a plan whose calls get_plan handed out. The hash must be the transaction that wallet ' +
        'sent for this plan: from its address, on the plan’s chain, with the call’s destination, value ' +
        'and data unchanged, and not already reported for another plan; anything else is refused. For a ' +
        'plan with several calls, report the last one’s hash. This sends nothing: it records what was ' +
        'already sent, and get_plan then says whether it confirmed.',
      inputSchema: {
        planId: z.string().describe('The planId a prepare_* tool returned.'),
        txHash: z.string().describe('The transaction hash the wallet’s CLI returned: 0x and 64 hex characters.'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ planId, txHash }) => {
      if (!hasScope(ctx.scopes, 'plans:write')) return denied('plans:write')
      const outcome = await reportExecution({ userId: ctx.userId, grantId: ctx.grantId }, deps, planId, txHash.trim())
      if (outcome.kind === 'not_found' || outcome.kind === 'bad_hash') return failure(reportText(outcome))
      const structured = { ...outcome.view, reported: outcome.kind === 'reported' || outcome.kind === 'already_reported' }
      return outcome.kind === 'reported' || outcome.kind === 'already_reported'
        ? text(reportText(outcome), structured)
        : { ...text(reportText(outcome), structured), isError: true }
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

  /**
   * Linking a wallet the agent operates. Two calls because the signature
   * happens somewhere else: in the vendor's CLI, on the person's machine.
   * Neither call signs, and the address is linked only if the signature over
   * the challenge recovers to it.
   */
  const linkWords = linkToolWords()
  server.registerTool(
    'link_agent_wallet_start',
    {
      title: 'Start linking an agent wallet',
      description:
        `First of two steps to link a wallet this agent operates through a vendor CLI (${linkWords.vendors}) ` +
        'to the person’s Ottopus account. Returns an EIP-712 challenge bound to the ' +
        'person, the address and the provider, with a short expiry, and how to sign it with that CLI. ' +
        'Sign it with the wallet itself, then call link_agent_wallet_finish. An address already linked ' +
        'as another kind of wallet is refused. Nothing is linked by this call. It needs the wallets:write ' +
        'scope, which the person allows on the consent page; the ottopus-agentic skill has the whole procedure.',
      inputSchema: {
        provider: z.string().describe(linkWords.provider),
        address: z.string().describe('The wallet’s 0x address, as its CLI reports it.'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async (input) => {
      if (!hasScope(ctx.scopes, 'wallets:write')) return denied('wallets:write')
      const outcome = await startLink(deps, ctx.userId, input)
      if (outcome.kind === 'refused') return failure(`Not started: ${outcome.reason}.`)
      const { challengeId, expiresAt, typedData, provider } = outcome.value
      return text(startText(outcome.value), {
        challengeId,
        expiresAt,
        typedData,
        provider: { id: provider.id, name: provider.name, cli: provider.cli, sign: provider.sign },
      })
    },
  )

  server.registerTool(
    'link_agent_wallet_finish',
    {
      title: 'Finish linking an agent wallet',
      description:
        'Second step: hand back the signature over the challenge from link_agent_wallet_start. If it ' +
        'recovers to the address the challenge names, the wallet is linked as an agent wallet and shows ' +
        'in list_wallets. A challenge works once and expires after a few minutes; a wrong signer, a ' +
        'replay or an expired challenge is refused with the reason. Linking proves which address the agent ' +
        'operates and nothing more: plans on it still wait for the person to approve.',
      inputSchema: {
        challengeId: z.string().describe('The challengeId link_agent_wallet_start returned.'),
        signature: z
          .string()
          .regex(/^(0x)?[0-9a-fA-F]+$/)
          .describe(linkWords.signature),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ challengeId, signature }) => {
      if (!hasScope(ctx.scopes, 'wallets:write')) return denied('wallets:write')
      const outcome = await finishLink(deps, ctx.userId, { challengeId, signature, clientId: ctx.clientId })
      if (outcome.kind === 'refused') return failure(`Not linked: ${outcome.reason}.`)
      const arm = outcome.value
      return text(finishText(arm), {
        wallet: {
          id: arm.id,
          name: arm.label ?? null,
          walletType: arm.walletType,
          namespace: arm.namespace,
          address: arm.address,
          agentProvider: arm.agentProvider,
          watchOnly: arm.isWatchOnly,
          ...capabilitiesOf(arm),
        },
      })
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
  const { stale, status, words: state, then } = stockStatus(info, now)
  const premium = stale ? null : stockPremium(info)
  const price = info.priceUsd === null ? 'price unavailable' : usd(info.priceUsd)
  const gap =
    premium === null
      ? stock.referencePriceUsd === null
        ? 'no reference price'
        : `reference ${usd(stock.referencePriceUsd)}`
      : `${premiumWords(premium)} reference`
  const ratio = Math.abs(stock.tokenToShareRatio - 1) >= 0.00005 ? `, ${stock.tokenToShareRatio.toFixed(4)} shares per token` : ''
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
    status,
    asOf: stock.asOf,
    stale,
    staleReason,
  }
}

function isStock(token: object): token is StockInfo {
  return 'stock' in token && typeof token.stock === 'object' && token.stock !== null
}

/**
 * A stock's market status, for every tool that reports one. One function so
 * find_asset and find_stock cannot drift apart: both say what verify's
 * `stockMarket` says, with the calendar's bells where the vendor left them
 * blank, and neither passes the vendor's raw open flag through.
 *
 * The vendor's reason code goes with its flag. When the calendar is what
 * closed the market the code still reads `TRADING`, which contradicts the
 * state beside it, so it is dropped and `source` says who made the call.
 */
function stockStatus(info: StockInfo, now: Date) {
  const stale = stockFactsStale(info, now)
  const readAt = new Date(Date.parse(info.stock.asOf))
  const market = stockMarket(info, stale && Number.isFinite(readAt.getTime()) ? readAt : now)
  const open = market.state !== 'closed' && market.state !== 'halted'
  const byCalendar = market.source === 'calendar' && market.state === 'closed'
  const halted = `halted${market.reason ? ` (${market.reason})` : ''}`
  const session = `market open (${stockMarketWords(market.state)})`
  return {
    stale,
    status: {
      state: market.state,
      open,
      source: market.source,
      reason: byCalendar ? null : market.reason,
      reasonMessage: market.note,
      nextOpenAt: market.nextOpenAt,
      nextCloseAt: market.nextCloseAt,
    },
    words:
      market.state === 'halted'
        ? halted
        : market.state === 'closed'
          ? `market closed${market.nextOpenAt ? `, opens ${market.nextOpenAt}` : ''}`
          : session,
    // What a stale reading said, without a next bell that may have rung.
    then: market.state === 'halted' ? halted : market.state === 'closed' ? 'market closed' : session,
  }
}

/** "+0.08% over" / "−1.40% under" / "at" — signed, two places, never bare. */
function premiumWords(premium: number): string {
  const pct = Math.abs(premium * 100)
  if (pct < 0.005) return 'at'
  return `${premium > 0 ? '+' : '−'}${pct.toFixed(2)}% ${premium > 0 ? 'over' : 'under'}`
}
