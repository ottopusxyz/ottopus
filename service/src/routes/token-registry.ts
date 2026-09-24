import { config } from '../config.js'
import {
  type StockRegistry,
  type TokenRegistry,
  compositeTokens,
  rwaTokens,
  zerionTokens,
} from '../connectors/tokens/index.js'
import { binanceClient } from './binance-client.js'

/**
 * The one token registry, for both surfaces and every tool.
 *
 * Stocks first, from Binance's RWA data, because the general registry
 * answers a stock symbol with the wrong contract. Zerion behind it for
 * everything else: the same provider as the portfolio, so a token has one
 * logo and one price whether or not the person holds it.
 *
 * One instance rather than one per surface, so a search or a token list is
 * fetched once and remembered for both. Null when neither credential is
 * set, and the words on a plan fall back rather than the plan failing.
 */
export const stockRegistry: StockRegistry | null = binanceClient ? rwaTokens({ client: binanceClient }) : null

const general: TokenRegistry | null = config.zerionApiKey
  ? zerionTokens({
      apiKey: config.zerionApiKey,
      ...(config.zerionApiUrl ? { baseUrl: config.zerionApiUrl } : {}),
    })
  : null

export const tokenRegistry: TokenRegistry | null =
  stockRegistry || general ? compositeTokens({ stocks: stockRegistry, tokens: general }) : null

if (!stockRegistry) console.error('[tokens] stock lookup disabled — no Binance credential; stock symbols resolve through the general registry only')
if (!general) console.error('[tokens] general token lookup disabled — ZERION_API_KEY is not set')
