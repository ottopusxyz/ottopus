/**
 * The token registry: what an asset is called, when nobody holds it.
 *
 * The portfolio knows every asset the person owns, which is exactly the
 * wrong set for a swap. The interesting half of a trade is the side they do
 * not have yet, and without a source for it three things break at once:
 *
 *   - The plan's own summary. `humanPlan.summary` is hashed, so a swap into
 *     an unheld token was permanently recorded as "about
 *     9,500,037,168,996,562,157 units of 0x4ed4…efed" — raw base units,
 *     because decimals defaulted to zero, and a truncated address for a name.
 *   - The review page's icon, which is looked up by asset id against the
 *     portfolio and simply missing for anything unheld.
 *   - The agent, which had no way to turn "DEGEN on Base" into a CAIP-19 id
 *     and was told never to guess a contract from a symbol. So it either
 *     guessed anyway or went off to some other service.
 *
 * One interface, because the provider will change. Nothing above this folder
 * names one.
 */

export interface TokenInfo {
  /** CAIP-19, canonical and lowercased, ready to hand to a prepare_* tool. */
  assetId: string
  symbol: string
  name: string
  decimals: number
  iconUrl: string | null
  priceUsd: number | null
  /**
   * The registry's own verification flag.
   *
   * Shown, never trusted as a safety claim: a token list saying "verified"
   * means somebody vouched for the listing, not that the contract is safe.
   * The decoder and the policy decide what is safe, and neither consults
   * this.
   */
  verified: boolean
  /**
   * Present when the token is a tokenized stock, from a registry that knows
   * stocks. Absent means "not known to be one", never "is not one".
   */
  stock?: StockFacts
}

export interface TokenRegistry {
  readonly name: string
  /** What this asset id is called. Null when the registry has never heard of it. */
  byAssetId(assetId: string): Promise<TokenInfo | null>
  /**
   * A symbol or a contract address on a chain, resolved to an asset id.
   *
   * Symbols are ambiguous by nature and the registry picks; the caller shows
   * the address it resolved to so a person can see which token was meant.
   */
  find(chainId: string, query: string): Promise<TokenInfo | null>
}

/**
 * What makes a token a tokenized stock, beside what makes it a token.
 *
 * A stock token has a provider (`bstock`, `ondo`), an underlying ticker,
 * a share ratio, a reference price off-chain, and a market that opens and
 * closes. None of that is guessable from the contract, and all of it bears
 * on whether a trade should be prepared at all: a halted market is a block,
 * a premium over the reference is a warning. Both are read from here.
 */
export interface StockFacts {
  /** The provider's id in the data source's words: `bstock`, `ondo`. */
  platformId: string
  /** The underlying's ticker, `NVDA`, which several providers share. */
  ticker: string
  companyName: string
  /** How many shares one token stands for. Drifts above 1 as dividends accrue. */
  tokenToShareRatio: number
  /** The underlying's price off-chain, in USD. Null when the source had none. */
  referencePriceUsd: number | null
  status: {
    /** Whether the underlying's venue is trading now. False for a halt and for a closed session alike; `reason` tells which. */
    open: boolean
    /** The source's session word — `overnight`, `regular` — when it gives one. */
    marketStatus: string | null
    /** The source's reason code, `TRADING` when open. */
    reason: string | null
    /** The source's sentence about the reason ("Paused for session transition"), when it gives one. */
    reasonMessage?: string | null
    nextOpenAt: string | null
    nextCloseAt: string | null
  }
  /** When these facts were read. Prices and status move; identity does not. */
  asOf: string
}

/** A token that is also a stock. What `stock` says is as fresh as `stock.asOf`. */
export interface StockInfo extends TokenInfo {
  stock: StockFacts
}

/**
 * The stock side of the registry, kept apart because a ticker has several
 * answers and the token interface has room for one.
 *
 * "NVDA" on BNB Chain is NVDAB from one provider and NVDAon from another,
 * at different prices and with different share ratios. Picking one silently
 * would bind a plan to a contract the person did not choose, so the answer
 * is the list, and the caller decides what to do with more than one.
 */
export interface StockRegistry {
  readonly name: string
  /**
   * Every provider variant on a chain for a ticker, a company name, a token
   * symbol or a contract address. An exact token symbol or an address names
   * one; a ticker or a company name may name several. Empty when the query
   * is not a stock the registry knows; null when the registry could not
   * answer at all, which is not the same thing.
   */
  variants(chainId: string, query: string): Promise<StockInfo[] | null>
  /** The stock behind an asset id. Null when it is not a stock, or on failure. */
  byAssetId(assetId: string): Promise<StockInfo | null>
}
