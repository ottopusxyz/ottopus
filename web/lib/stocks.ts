/**
 * Tokenized-stock issuers, as the service names them and as people write them.
 *
 * The service's word is the registry's id, `bstock`; the page writes the
 * issuer's own casing. Here rather than beside the review model so that
 * the portfolio's token table and the review card draw the same mark
 * without either importing the other.
 */
export const ISSUER_NAMES: Readonly<Record<string, string>> = {
  bstock: 'bStock',
  ondo: 'Ondo',
  xstocks: 'xStocks',
}

/** The issuer's name as people write it, or the service's word for one the page has not met. */
export function issuerName(issuer: string): string {
  return ISSUER_NAMES[issuer] ?? issuer
}

/** The issuers with a file in public/stocks. Kept in step with that folder. */
export const ISSUER_MARKS: ReadonlySet<string> = new Set(['bstock', 'ondo'])

/**
 * The issuer's own mark, as a path under public/, or null for an issuer we
 * have no mark for. See public/stocks/README.md for where they came from.
 */
export function issuerMark(issuer: string): string | null {
  return ISSUER_MARKS.has(issuer) ? `/stocks/${issuer}.svg` : null
}
