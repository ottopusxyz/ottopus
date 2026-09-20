import { config } from '../config.js'
import {
  ZerionPortfolioConnector,
  cached,
  type PortfolioConnector,
} from '../connectors/portfolio/index.js'

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
export const portfolioProvider: PortfolioConnector | null = config.zerionApiKey
  ? cached(
      new ZerionPortfolioConnector({
        apiKey: config.zerionApiKey,
        ...(config.zerionApiUrl ? { baseUrl: config.zerionApiUrl } : {}),
      }),
    )
  : null

if (!portfolioProvider) console.error('[portfolio] balances disabled — ZERION_API_KEY is not set')
