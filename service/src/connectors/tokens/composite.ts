import type { StockRegistry, TokenInfo, TokenRegistry } from './types.js'

/**
 * The stock registry in front of the general one.
 *
 * A stock symbol goes to the source that knows stocks, and only if that
 * source has never heard of the query does the general registry get a turn.
 * The order is the whole point: asked for "NVDAB", the general registry
 * confidently answers a different token, so it must not be asked at all
 * once the stock side has an opinion.
 *
 * Three things the stock side can say, and what each means here:
 *
 *   - one variant: that is the token.
 *   - several variants: a bare ticker on a chain with more than one
 *     provider. Nobody picks. `find` answers null and does not fall through,
 *     because the general registry would pick, and wrongly; the caller asks
 *     the stock registry for the variants and shows the choice.
 *   - none: not a stock the registry knows. The general registry answers,
 *     which is how a plain token, or an xStock the stock data does not
 *     index, is still found.
 *
 * A stock registry that could not answer at all reads as "none": the trade
 * is a token the general registry probably knows, and a vendor's bad minute
 * should not take every lookup down with it.
 */

export interface CompositeTokenOptions {
  stocks: StockRegistry | null
  tokens: TokenRegistry | null
}

export function compositeTokens({ stocks, tokens }: CompositeTokenOptions): TokenRegistry {
  return {
    name: [stocks?.name, tokens?.name].filter(Boolean).join('+') || 'none',

    async byAssetId(assetId): Promise<TokenInfo | null> {
      const stock = await stocks?.byAssetId(assetId)
      if (stock) return stock
      return (await tokens?.byAssetId(assetId)) ?? null
    },

    async find(chainId, query): Promise<TokenInfo | null> {
      const found = await stocks?.variants(chainId, query)
      if (found && found.length === 1) return found[0]!
      if (found && found.length > 1) return null
      return (await tokens?.find(chainId, query)) ?? null
    },
  }
}
