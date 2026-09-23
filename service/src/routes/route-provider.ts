import { config } from '../config.js'
import {
  type RouteConnector,
  binanceRouteConnector,
  chooser,
  lifiConnector,
  uniswapConnector,
} from '../connectors/route/index.js'
import { binanceClient } from './binance-client.js'

/**
 * The one route provider, for both surfaces.
 *
 * Binance first, on BNB Chain alone: it aggregates the venues where the
 * tokenized stocks trade, answered faster and better than the others when
 * measured, and its `serves()` declines every other chain and every
 * bridge, so the chooser never asks it anything else. Uniswap next, on the
 * chains it serves: a swap through the venue's own pools is the most direct
 * route there is, and the one a person most readily recognises on the
 * review page. LI.FI behind both, for every chain neither serves and every
 * pair they find no route for — including a stock quoted as an RFQ order,
 * which Binance refuses and LI.FI routes as a plain swap.
 *
 * Without a Binance credential there is no Binance; without a Uniswap key
 * there is only LI.FI, which is what the service shipped with.
 */
export const routeProvider: RouteConnector = chooser([
  ...(binanceClient ? [binanceRouteConnector({ client: binanceClient })] : []),
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

if (!binanceClient) console.error('[route] Binance routing disabled — no Binance credential; BNB Chain swaps go to the next provider')
if (!config.uniswapApiKey) console.error('[route] Uniswap routing disabled — UNISWAP_API_KEY is not set; LI.FI routes everything else')
