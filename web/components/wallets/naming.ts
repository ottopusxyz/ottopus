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

/**
 * A tint per wallet client, so the eight arms are told apart by colour before
 * they are read. Each is the client's own brand colour — what the person
 * already associates with that wallet.
 *
 * The foreground is stored rather than derived, because it genuinely differs:
 * navy clears AA on the light and mid tints, cream on the dark blues, and no
 * single choice works for both. `--ot-on-state` is reserved for Ottopus's own
 * state fills, so these carry their own values.
 *
 * Rainbow and Zerion are shaded a step darker than their published brand
 * colour. At the true value neither navy nor cream reaches 4.5:1 on a 15px
 * bold glyph — 3.27 and 3.20 at best. The hue survives; the failure does not.
 */
export const WALLET_AVATARS: Readonly<Record<string, { bg: string; fg: string }>> = {
  metamask: { bg: '#E17726', fg: '#16213E' }, // 5.20
  rabby_wallet: { bg: '#7084FF', fg: '#16213E' }, // 4.87
  coinbase_wallet: { bg: '#0052FF', fg: '#FFF0DC' }, // 5.14
  rainbow: { bg: '#5665BE', fg: '#FFF0DC' }, // 4.69, darkened from #5C6BC0
  phantom: { bg: '#AB9FF2', fg: '#16213E' }, // 6.79
  zerion: { bg: '#1E5DFF', fg: '#FFF0DC' }, // 4.61, darkened from #2461FF
  wallet_connect: { bg: '#3B99FC', fg: '#16213E' }, // 5.41
  walletconnect: { bg: '#3B99FC', fg: '#16213E' }, // 5.41
  okx_wallet: { bg: '#BFC3C7', fg: '#16213E' }, // 8.97
  brave_wallet: { bg: '#FB542B', fg: '#16213E' }, // 4.85
  trust: { bg: '#306FB2', fg: '#FFF0DC' }, // 4.64, darkened from #3375BB
  uniswap: { bg: '#D60066', fg: '#FFF0DC' }, // 4.63, darkened from #FF007A
  safe: { bg: '#12FF80', fg: '#16213E' }, // 11.84
}

/**
 * Wallet client to something a person recognises.
 *
 * Keys are Privy's `walletClientType` values verbatim, and several carry a
 * `_wallet` suffix that is easy to guess wrong — it is `rabby_wallet`, not
 * `rabby`. Getting one wrong is silent: the arm falls through to the humanised
 * fallback and renders as "rabby wallet" with no tint, which looks like a
 * styling slip rather than a missing entry.
 */
export const WALLET_NAMES: Readonly<Record<string, string>> = {
  metamask: 'MetaMask',
  rabby_wallet: 'Rabby',
  coinbase_wallet: 'Coinbase Wallet',
  coinbase_smart_wallet: 'Coinbase Smart Wallet',
  base_account: 'Base Account',
  rainbow: 'Rainbow',
  phantom: 'Phantom',
  zerion: 'Zerion',
  safe: 'Safe',
  trust: 'Trust',
  uniswap: 'Uniswap',
  okx_wallet: 'OKX Wallet',
  brave_wallet: 'Brave Wallet',
  bitget_wallet: 'Bitget Wallet',
  backpack: 'Backpack',
  wallet_connect: 'WalletConnect',
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

/**
 * The wallet client, for the chip beside the name — "Treasury · Ledger".
 *
 * Null when it would only repeat the name. An unlabelled MetaMask arm is
 * already called "MetaMask", and "MetaMask · MetaMask" is the kind of thing
 * that looks like a rendering bug rather than a detail.
 */
export function walletClientName(arm: Pick<Arm, 'label' | 'walletType'>): string | null {
  const client = WALLET_NAMES[arm.walletType]
  if (!client || client === armName(arm)) return null
  // Watch-only is not a wallet client, it is the absence of one — the proof
  // mark already says so, and repeating it as a make of wallet is misleading.
  if (arm.walletType === 'watch_only') return null
  return client
}
