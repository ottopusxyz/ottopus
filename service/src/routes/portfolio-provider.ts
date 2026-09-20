import { config } from '../config.js'
import { ZerionActivityConnector, type ActivityConnector } from '../connectors/activity/index.js'
import {
  ZerionPortfolioConnector,
  cached,
  type PortfolioConnector,
} from '../connectors/portfolio/index.js'
import { ZerionClient } from '../connectors/zerion/client.js'

/**
 * The one portfolio connector, behind the one cache.
 *
 * Both surfaces read balances — the web app for the portfolio page, the MCP
 * surface for `get_portfolio` — and they have to share an instance, not merely
 * a class: the cache in front of the vendor is what keeps an agent polling and
 * a person refreshing from spending the quota twice on the same wallet.
 *
 * Null when there is no key. A deployment with Privy wired up and no Zerion
 * key should still sign people in and link wallets — only the numbers are
 * missing — so each surface says "not configured" for balances alone rather
 * than refusing everything.
 */
const client: ZerionClient | null = config.zerionApiKey
  ? new ZerionClient({
      apiKey: config.zerionApiKey,
      ...(config.zerionApiUrl ? { baseUrl: config.zerionApiUrl } : {}),
    })
  : null

export const portfolioProvider: PortfolioConnector | null = client
  ? cached(new ZerionPortfolioConnector({ apiKey: config.zerionApiKey!, client }))
  : null

/**
 * The history reader, on the same client so the chain list loads once. No
 * cache in front of it: a page is asked for once and paged from, and a
 * fresh page is the point of a refresh.
 */
export const activityProvider: ActivityConnector | null = client
  ? new ZerionActivityConnector({ apiKey: config.zerionApiKey!, client })
  : null

if (!portfolioProvider) console.error('[portfolio] balances and activity disabled — ZERION_API_KEY is not set')
