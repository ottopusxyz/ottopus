import { config } from '../config.js'
import { BinanceClient } from '../connectors/binance/index.js'

/**
 * The one signed Binance client, for every connector that speaks to the
 * vendor: routing, stock data, the review page's second simulation. One
 * instance, so the clock offset it learns from the vendor's first refusal
 * is learned once and not per feature.
 *
 * Null when the credential is absent, and every feature behind it then says
 * so in its own words rather than failing at the first request. The config
 * already refuses half a credential at boot, so "absent" here means both.
 */
export const binanceClient: BinanceClient | null =
  config.binanceApiKey && config.binanceSecretKey
    ? new BinanceClient({
        apiKey: config.binanceApiKey,
        secretKey: config.binanceSecretKey,
        ...(config.binanceApiUrl ? { baseUrl: config.binanceApiUrl } : {}),
      })
    : null

if (!binanceClient) console.error('[binance] disabled — BINANCE_WEB3_API_KEY and BINANCE_WEB3_SECRET_KEY are not set')
