import type { Arm } from '@/lib/api'

/**
 * The strings and rules the wallet surfaces share, kept out of the components
 * so they can be tested without a DOM — the whole web suite runs in node.
 */

/** 20 bytes of hex. Checked in the browser only to say so before a round trip;
 * the service validates independently and is the one that decides. */
export const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/

/**
 * Otto has eight arms. The service enforces this — the copy here only has to
 * agree with it, and a mismatch would offer room that does not exist. There is
 * a test that reads the service's constant and compares.
 */
export const MAX_ARMS = 8

/** Wallet client to something a person recognises. */
export const WALLET_NAMES: Readonly<Record<string, string>> = {
  metamask: 'MetaMask',
  rabby: 'Rabby',
  coinbase_wallet: 'Coinbase Wallet',
  rainbow: 'Rainbow',
  phantom: 'Phantom',
  zerion: 'Zerion',
  safe: 'Safe',
  walletconnect: 'WalletConnect',
  watch_only: 'Watch-only',
  unknown: 'Wallet',
}

/**
 * What each service error code means to a person. Anything unmapped falls back
 * to a generic line rather than showing the code — `too_many_wallets` on screen
 * is a bug report, not a message.
 */
export const LINK_ERRORS: Readonly<Record<string, string>> = {
  already_linked: 'That address is already one of your arms.',
  too_many_wallets: 'All eight arms are full. Unlink one first.',
  invalid_address: 'That does not look like a wallet address.',
}

/**
 * A person's label wins over the wallet client's name: someone who called it
 * "Treasury" should see "Treasury", not "Safe".
 */
export function armName(arm: Pick<Arm, 'label' | 'walletType'>): string {
  if (arm.label) return arm.label
  return WALLET_NAMES[arm.walletType] ?? arm.walletType.replace(/_/g, ' ')
}
