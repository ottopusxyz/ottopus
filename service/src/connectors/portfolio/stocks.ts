import type { StockRegistry } from '../tokens/types.js'
import type { AccountPosition, AccountRef, PortfolioConnector } from './types.js'

/**
 * Stock tokens named by the registry that knows them, by address.
 *
 * The portfolio provider lists the NVIDIA bStock as "N4B", unverified and
 * without a logo, so a person holding it sees a token they do not
 * recognise, on the portfolio, on the requests table and on the review
 * card, all of which take their words from here. The stock registry knows
 * the same contract as NVDAB with its issuer and its logo, and its word
 * wins for every address it knows. Everything else stays the provider's.
 *
 * By address on the chain, never by symbol: a token calling itself "NVDA"
 * at some other address keeps the provider's words and earns no logo.
 *
 * A registry that cannot answer leaves the provider's words standing, and
 * says so once on the log. A held balance with no name is worse on a
 * portfolio page than a held balance under the provider's name, and unlike
 * a plan summary nothing here is hashed or approved. The plan path has the
 * stricter rule, in the token composite.
 *
 * A decorator, like the cache, so the aggregate and the routes never learn
 * that stocks exist. Outside the cache rather than inside it, so a miss at
 * the moment the cache filled does not hold a wrong name for its lifetime.
 */
export interface StockNamedOptions {
  /** Where a registry miss is reported. The service log by default. */
  log?: (message: string) => void
}

export function stockNamed(
  connector: PortfolioConnector,
  stocks: StockRegistry,
  options: StockNamedOptions = {},
): PortfolioConnector {
  const log = options.log ?? console.error

  const wrapped: PortfolioConnector = {
    provider: connector.provider,

    async positionsFor(account: AccountRef): Promise<AccountPosition[]> {
      const positions = await connector.positionsFor(account)
      let missed = 0
      const named = await Promise.all(
        positions.map(async (position) => {
          const looked = await stocks.stockOf(position.assetId)
          if (looked.kind === 'unknown') missed++
          if (looked.kind !== 'stock') return position
          const { info } = looked
          return {
            ...position,
            asset: {
              ...position.asset,
              symbol: info.symbol,
              name: info.name,
              iconUrl: info.iconUrl ?? position.asset.iconUrl,
              // A curated list of stock tokens is a listing claim, which is
              // exactly what this flag means and all it means.
              verified: true,
              stock: { issuer: info.stock.platformId, ticker: info.stock.ticker },
            },
          }
        }),
      )
      if (missed > 0) {
        log(
          `[portfolio] ${stocks.name} could not say whether ${missed} of ${positions.length} positions of ` +
            `${account.namespace}:${account.address} are stocks; ${connector.provider}'s names stand for them`,
        )
      }
      return named
    },
  }

  // Only forwarded when the wrapped connector has one, so `chainName` in
  // wrapped is absent rather than present-and-undefined.
  if (connector.chainName) {
    wrapped.chainName = (chainId: string) => connector.chainName!(chainId)
  }
  if (connector.chainIcon) {
    wrapped.chainIcon = (chainId: string) => connector.chainIcon!(chainId)
  }
  return wrapped
}
