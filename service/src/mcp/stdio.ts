import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { findUserById } from '../auth/session.js'
import { config } from '../config.js'
import { readPortfolio } from '../connectors/portfolio/index.js'
import { baselineSimulator, composite } from '../connectors/simulation/index.js'
import { zerionTokens } from '../connectors/tokens/index.js'
import { getDb } from '../db/client.js'
import { SCOPES } from '../oauth/scopes.js'
import { createPlan, findPlan, issueReviewLink, recordSimulation, transition } from '../plans/index.js'
import { portfolioProvider } from '../routes/portfolio-provider.js'
import { routeProvider } from '../routes/route-provider.js'
import { httpLookups } from '../verify/index.js'
import { listWallets } from '../wallets/index.js'
import { buildServer, type ToolDeps } from './server.js'

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

  // The same reads the remote surface wires, against the same database: a
  // tool that answered differently over stdio would be a tool nobody tested.
  if (!config.databaseUrl) {
    console.error('[mcp:stdio] set DATABASE_URL — the tools read wallets from it')
    process.exit(1)
  }
  const db = getDb(config.databaseUrl)
  const provider = portfolioProvider
  const deps: ToolDeps = {
    findUser: (id) => findUserById(db, id),
    // No client row: nothing registered, because nothing was asked to.
    findAgent: async () => ({ clientName: 'This local agent' }),
    listWallets: (id) => listWallets(db, id),
    readPortfolio: provider ? (arms) => readPortfolio(provider, arms) : null,
    lookups: httpLookups({ rpcUrlTemplate: config.rpcUrlTemplate }),
    /**
     * Not wired: preparing a plan does not simulate.
     *
     * The review page runs its own simulation in the browser, against the
     * block the person is reading at, and refuses to sign a plan that
     * reverts there. A second run minutes earlier, on the service, bought a
     * gate that the page already holds and cost every tool call a round trip
     * to the chain. The adapter stays behind this line: passing
     * `composite([baselineSimulator({ rpcUrlTemplate: config.rpcUrlTemplate })])`
     * turns it back on, and the pipeline is still tested that way.
     */
    simulator: null,
    /**
     * Wired, for prepare_custom alone.
     *
     * The reasoning above does not carry to agent-authored calls. The
     * browser run is asymmetric — it can only take signing away — and a
     * custom plan is *granted* by its simulation: the check of what the run
     * saw leave against what the agent declared is the reason the plan is
     * allowed to exist. A grant has to come from a run the service made,
     * against a block it recorded, before a link is minted. The other tools
     * never read this field, so the decision above stands for them.
     */
    customSimulator: composite([baselineSimulator({ rpcUrlTemplate: config.rpcUrlTemplate })]),
    // Same provider as the portfolio, so a token has one logo and one price
    // whether or not the person holds it. No key means no registry, and the
    // words fall back rather than the plan failing.
    tokens: config.zerionApiKey
      ? zerionTokens({
          apiKey: config.zerionApiKey,
          ...(config.zerionApiUrl ? { baseUrl: config.zerionApiUrl } : {}),
        })
      : null,
    router: routeProvider,
    createPlan: (input) => createPlan(db, input),
    issueReviewLink: (planId, version, planExpiresAt) =>
      issueReviewLink(db, { planId, version, planExpiresAt }, config.webUrl),
    recordSimulation: (input) => recordSimulation(db, input),
    findPlan: (userId, planId) => findPlan(db, userId, planId),
    transition: (input) => transition(db, input),
  }

  const server = buildServer(
    {
      userId,
      clientId: 'stdio',
      // No grant to narrow, because there was no consent screen to narrow it.
      scopes: [...SCOPES],
      grantId: null,
    },
    deps,
  )

  await server.connect(new StdioServerTransport())
  console.error('[mcp:stdio] ready')
}

main().catch((err: unknown) => {
  console.error('[mcp:stdio]', err)
  process.exit(1)
})
