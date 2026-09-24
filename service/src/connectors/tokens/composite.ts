import { EVM_ADDRESS_RE } from '../../core/index.js'
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
 * A stock registry that could not answer at all is not "none". Until the
 * stock side has said whether a symbol is a stock, the general registry
 * must not be asked, or a vendor's bad minute would resolve "NVDAB" to the
 * wrong contract, which is the one thing this composite exists to prevent.
 * So a symbol answers null through an outage, plain tokens included: a
 * lookup that fails is a plan not built, and a lookup that lies is a plan
 * bound to the wrong token. An address is different. It names one contract
 * whoever answers, so the general registry may still describe it.
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
      if (stocks) {
        const found = await stocks.variants(chainId, query)
        if (found === null && !EVM_ADDRESS_RE.test(query.trim())) return null
        if (found && found.length === 1) return found[0]!
        if (found && found.length > 1) return null
      }
      return (await tokens?.find(chainId, query)) ?? null
    },
  }
}
