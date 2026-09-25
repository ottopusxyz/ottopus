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
 * stock side has said whether a query is a stock, the general registry
 * must not be asked, or a vendor's bad minute would resolve "NVDAB" to the
 * wrong contract, or name the real one "N4B" on a plan summary that is then
 * hashed and approved. So a query answers null through an outage, plain
 * tokens and addresses included, and the miss is logged: a lookup that
 * fails is a plan not built or an asset named by its address, and a lookup
 * that lies is a plan bound to the wrong token or the wrong name. The
 * accepted cost is that through an outage an unheld stock reads as its
 * address rather than as a name somebody else made up for it.
 */

export interface CompositeTokenOptions {
  stocks: StockRegistry | null
  tokens: TokenRegistry | null
  /** Where a stock-side miss is reported. The service log by default. */
  log?: (message: string) => void
}

export function compositeTokens({ stocks, tokens, log = console.error }: CompositeTokenOptions): TokenRegistry {
  const missed = (what: string) =>
    log(`[tokens] ${stocks?.name ?? 'stocks'} could not say whether ${what} is a stock; not asking ${tokens?.name ?? 'anyone'} in its place`)

  return {
    name: [stocks?.name, tokens?.name].filter(Boolean).join('+') || 'none',

    async byAssetId(assetId): Promise<TokenInfo | null> {
      if (stocks) {
        const looked = await stocks.stockOf(assetId)
        if (looked.kind === 'stock') return looked.info
        if (looked.kind === 'unknown') {
          missed(assetId)
          return null
        }
      }
      return (await tokens?.byAssetId(assetId)) ?? null
    },

    async find(chainId, query): Promise<TokenInfo | null> {
      if (stocks) {
        const found = await stocks.variants(chainId, query)
        if (found === null) {
          missed(`${EVM_ADDRESS_RE.test(query.trim()) ? query.trim() : `"${query}"`} on ${chainId}`)
          return null
        }
        if (found.length === 1) return found[0]!
        if (found.length > 1) return null
      }
      return (await tokens?.find(chainId, query)) ?? null
    },
  }
}
