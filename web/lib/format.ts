/**
 * Display formatting for values that are dangerous to get wrong.
 *
 * Amounts arrive as integer strings in base units — 10^18 wei exceeds
 * Number.MAX_SAFE_INTEGER, so every conversion here goes through BigInt. A
 * float would round an amount someone is about to sign.
 */

/** Middle-truncate an address: 0x7a3F…9c2E. Casing is preserved for display. */
export function truncateAddress(address: string, lead = 6, tail = 4): string {
  if (address.length <= lead + tail + 1) return address
  return `${address.slice(0, lead)}…${address.slice(-tail)}`
}

/** The address out of a CAIP-10 identifier, or the input if it is already bare. */
export function addressOf(idOrAddress: string): string {
  const parts = idOrAddress.split(':')
  return parts.length === 3 ? parts[2]! : idOrAddress
}

export interface FormatAmountOptions {
  /** Significant fraction digits to show. Trailing zeros are trimmed. */
  maxFractionDigits?: number
  /** Group the integer part with separators. */
  grouping?: boolean
}

/**
 * Base units to a human string, exactly. No floating point anywhere: the
 * integer and fraction parts are sliced out of the digit string.
 *
 * Truncates rather than rounds — showing more than someone actually has, or
 * more than they will receive, is the worse error on a review page.
 */
export function formatAmount(
  baseUnits: string,
  decimals: number,
  options: FormatAmountOptions = {},
): string {
  const { maxFractionDigits = 6, grouping = true } = options

  if (!/^[0-9]+$/.test(baseUnits)) throw new Error(`not an integer amount: ${baseUnits}`)
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36) {
    throw new Error(`unreasonable decimals: ${decimals}`)
  }

  const padded = baseUnits.padStart(decimals + 1, '0')
  const whole = padded.slice(0, padded.length - decimals)
  const fractionAll = decimals === 0 ? '' : padded.slice(padded.length - decimals)

  const fraction = fractionAll.slice(0, maxFractionDigits).replace(/0+$/, '')
  const wholeOut = grouping ? BigInt(whole).toLocaleString('en-US') : String(BigInt(whole))

  // Checked before the empty-fraction shortcut below: an amount smaller than
  // the visible precision trims to nothing, and rendering it as "0" would read
  // as nothing moving. Show that it is dust instead of hiding it.
  if (BigInt(whole) === 0n && fraction === '' && BigInt(baseUnits) > 0n) {
    const firstSignificant = fractionAll.search(/[1-9]/)
    if (firstSignificant >= 0) return `<0.${'0'.repeat(firstSignificant)}1`
  }

  if (fraction === '') return wholeOut
  return `${wholeOut}.${fraction}`
}

export interface Money {
  /** Grouped, with the sign already in it: "$12,431" or "−$40". */
  whole: string
  /** Two digits, always. The Figure dims these. */
  fraction: string
}

/**
 * A fiat total, split so the headline can dim the cents.
 *
 * Unlike `formatAmount` this takes a number, and that is deliberate: fiat
 * values arrive from a pricing provider as floats and are estimates to begin
 * with. Token amounts are the ones that must never round, and they have their
 * own function.
 *
 * The minus sign is U+2212, not a hyphen — it is the same width as a digit, so
 * a column of tabular figures does not shift when one goes negative.
 */
export function formatMoney(value: number, currency = 'usd'): Money {
  const safe = Number.isFinite(value) ? value : 0
  const symbol = CURRENCY_SYMBOLS[currency.toLowerCase()] ?? ''

  // Rounded once, then split — rounding after the split can carry into the
  // whole part and print $12,430.100 for 12430.999.
  const cents = Math.round(Math.abs(safe) * 100)
  const whole = Math.trunc(cents / 100)
  const fraction = cents % 100

  return {
    whole: `${safe < 0 ? '−' : ''}${symbol}${whole.toLocaleString('en-US')}`,
    fraction: String(fraction).padStart(2, '0'),
  }
}

const CURRENCY_SYMBOLS: Record<string, string> = {
  usd: '$',
  eur: '€',
  gbp: '£',
  jpy: '¥',
  inr: '₹',
}

/** The whole and the cents as one string — for a table cell, not a headline. */
export function formatMoneyFlat(value: number, currency = 'usd'): string {
  const { whole, fraction } = formatMoney(value, currency)
  return `${whole}.${fraction}`
}

/**
 * A daily change, as the line under the headline reads it.
 *
 * Returns null when there is nothing to say: no change at all, or no holdings
 * to have changed. "+$0.00 (0.00%) today" over an empty portfolio is noise
 * dressed as information.
 */
export function formatDelta(
  change: number,
  gross: number,
  currency = 'usd',
): { text: string; direction: 'up' | 'down' } | null {
  if (!Number.isFinite(change) || change === 0) return null

  const sign = change > 0 ? '+' : '−'
  const money = formatMoneyFlat(Math.abs(change), currency)
  // Yesterday's value is today's minus the change — the denominator a percent
  // change is actually against. Falling back to today's would understate a rise
  // and overstate a fall.
  const before = gross - change
  const percent = before > 0 ? ` (${((Math.abs(change) / before) * 100).toFixed(2)}%)` : ''

  return { text: `${sign}${money}${percent} today`, direction: change > 0 ? 'up' : 'down' }
}

/** A 0..1 share as a percentage. Below a tenth of a percent, say so. */
export function formatShare(share: number): string {
  // A row worth nothing is 0.0% of the whole, the same way its value reads
  // $0.00 — a dash beside a figure of zero looked like a missing reading.
  if (!Number.isFinite(share)) return '—'
  if (share <= 0) return '0.0%'
  if (share < 0.001) return '<0.1%'
  return `${(share * 100).toFixed(1)}%`
}
