import { config } from '../config.js'
import { type RouteConnector, chooser, lifiConnector, uniswapConnector } from '../connectors/route/index.js'

/**
 * The one route provider, for both surfaces.
 *
 * Uniswap first, on the chains it serves: a swap through the venue's own
 * pools is the most direct route there is, and the one a person most
 * readily recognises on the review page. LI.FI behind it, for every chain
 * Uniswap does not serve and every pair it finds no route for. Without a
 * Uniswap key there is only LI.FI, which is what the service shipped with.
 */
export const routeProvider: RouteConnector = chooser([
  ...(config.uniswapApiKey
    ? [
        uniswapConnector({
          apiKey: config.uniswapApiKey,
          ...(config.uniswapApiUrl ? { baseUrl: config.uniswapApiUrl } : {}),
        }),
      ]
    : []),
  lifiConnector({
    apiKey: config.lifiApiKey,
    ...(config.lifiApiUrl ? { baseUrl: config.lifiApiUrl } : {}),
  }),
])

if (!config.uniswapApiKey) console.error('[route] Uniswap routing disabled — UNISWAP_API_KEY is not set; LI.FI routes everything')
