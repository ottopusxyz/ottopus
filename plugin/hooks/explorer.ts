/**
 * Where a confirmed plan's transaction can be looked up, and the chain's own
 * colour for the button that leads there.
 *
 * The address is built here, from a chain this table knows and a hash that
 * looks like one. A status result never hands the card a link: a server that
 * could would be a server that could send the person anywhere.
 */
export type Explorer = { href: string; fill: string; ink: string }

const NAVY = '#16213E'
const WHITE = '#FFFFFF'
const BLACK = '#000000'

/** The label is whichever of navy, white and black clears AA on the chain's fill. */
const CHAINS: Record<string, { base: string; fill: string; ink: string }> = {
  'eip155:1': { base: 'https://etherscan.io', fill: '#627EEA', ink: BLACK },
  'eip155:10': { base: 'https://optimistic.etherscan.io', fill: '#FF0420', ink: BLACK },
  'eip155:56': { base: 'https://bscscan.com', fill: '#F0B90B', ink: NAVY },
  'eip155:137': { base: 'https://polygonscan.com', fill: '#8247E5', ink: WHITE },
  'eip155:204': { base: 'https://opbnb.bscscan.com', fill: '#F0B90B', ink: NAVY },
  'eip155:8453': { base: 'https://basescan.org', fill: '#0052FF', ink: WHITE },
  'eip155:42161': { base: 'https://arbiscan.io', fill: '#12AAFF', ink: NAVY },
  'eip155:43114': { base: 'https://snowtrace.io', fill: '#E84142', ink: BLACK },
}

export const EXPLORER_CHAINS = Object.keys(CHAINS)

const TX_HASH = /^0x[0-9a-fA-F]{64}$/

/** A transaction hash, or null for anything that only claims to be one. */
export function txHashOf(v: unknown): string | null {
  return typeof v === 'string' && TX_HASH.test(v) ? v : null
}

/** The explorer page for a transaction, or null on a chain not in the table. */
export function explorerOf(chainId: string | null | undefined, txHash: string | null | undefined): Explorer | null {
  const chain = chainId ? CHAINS[chainId] : undefined
  const hash = txHashOf(txHash)
  if (!chain || !hash) return null
  return { href: `${chain.base}/tx/${hash}`, fill: chain.fill, ink: chain.ink }
}
