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
