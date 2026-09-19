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
