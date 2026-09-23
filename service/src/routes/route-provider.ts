import { config } from '../config.js'
import { type RouteConnector, binanceRouteConnector, chooser, lifiConnector } from '../connectors/route/index.js'
import { binanceClient } from './binance-client.js'

/**
 * The one route provider, for both surfaces.
 *
 * Binance first, on the chains `BINANCE_ROUTE_CHAINS` names (BNB Chain
 * alone by default): it aggregates the venues where the tokenized stocks
 * trade, answered faster and better than the others when measured, and its
 * `serves()` reads the same list, declining every chain not on it and every
 * bridge, so the chooser never asks it anything else. LI.FI behind it, for
 * every chain Binance does not serve and every pair Binance finds no route
 * for — including a stock quoted as an RFQ order, which Binance refuses and
 * LI.FI routes as a plain swap.
 *
 * Without a Binance credential there is only LI.FI, which is what the
 * service shipped with.
 */
export const routeProvider: RouteConnector = chooser([
  ...(binanceClient ? [binanceRouteConnector({ client: binanceClient, chains: config.binanceRouteChains })] : []),
  lifiConnector({
    apiKey: config.lifiApiKey,
    ...(config.lifiApiUrl ? { baseUrl: config.lifiApiUrl } : {}),
  }),
])

if (!binanceClient) console.error('[route] Binance routing disabled — no Binance credential; BNB Chain swaps go to the next provider')
