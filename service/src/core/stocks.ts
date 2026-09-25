import type { PlanStock } from './plan.js'

/**
 * What this trade pays or receives per share, from the quote alone.
 *
 * The registry's premium says where the token trades against par in the
 * pool at large. This says what the person's own trade comes to: the other
 * side of the quote in dollars, over the shares the stock side stands for.
 * The two differ by the route's fees and its price impact, which is exactly
 * what a person weighing a buy wants to see beside the share price.
 *
 * Shares, not tokens: a token stands for `tokenToShareRatio` shares, which
 * drifts above one as dividends accrue, so a price per token would read as a
 * premium the trade does not carry.
 */
export interface EffectiveStockInput {
  /** Which side the stock is on: `to` is a buy, `from` a sell. */
  role: 'from' | 'to'
  /** The stock tokens this trade moves, in base units, and how to read them. */
  tokens: { amount: string; decimals: number }
  tokenToShareRatio: number
  /** The other side of the trade: what is paid for the stock, or received for it. */
  counter: { amount: string; decimals: number; symbol: string; priceUsd: number | null }
  referencePriceUsd: number | null
}

export type EffectiveStockPrice = NonNullable<PlanStock['effective']>

/**
 * Null when the arithmetic has nothing to stand on: no price for the other
 * side, or an amount of zero on either. The plan records the absence, and
 * the page says so, rather than printing a figure from a guess.
 */
export function effectiveStockPrice(input: EffectiveStockInput): EffectiveStockPrice | null {
  const { counter, tokens, tokenToShareRatio, referencePriceUsd } = input
  if (counter.priceUsd === null || !(counter.priceUsd > 0)) return null
  const shares = units(tokens.amount, tokens.decimals) * tokenToShareRatio
  const counterUnits = units(counter.amount, counter.decimals)
  if (!(shares > 0) || !(counterUnits > 0)) return null
  const valueUsd = counterUnits * counter.priceUsd
  const priceUsd = valueUsd / shares
  const premiumBps =
    referencePriceUsd !== null && referencePriceUsd > 0 ? Math.round((priceUsd / referencePriceUsd - 1) * 10_000) : null
  return {
    counterSymbol: counter.symbol,
    counterPriceUsd: decimalString(counter.priceUsd),
    shares: decimalString(shares),
    valueUsd: decimalString(valueUsd),
    priceUsd: decimalString(priceUsd),
    premiumBps,
  }
}

/** Base units as a number. Precise enough for a price; never for an amount that gets signed. */
function units(amount: string, decimals: number): number {
  return Number(amount) / 10 ** decimals
}

/**
 * A number as the decimal string the plan stores: the hash takes no floats.
 * Eight places, trailing zeros dropped, never exponent form: "224.13", "1",
 * "1.00077822". Eight is past what any price or share ratio here carries.
 */
export function decimalString(n: number): string {
  const fixed = n.toLocaleString('en-US', { useGrouping: false, maximumFractionDigits: 8 })
  return fixed === '-0' ? '0' : fixed
}
