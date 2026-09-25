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
