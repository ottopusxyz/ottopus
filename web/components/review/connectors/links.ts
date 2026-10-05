/**
 * Links that open this page inside a wallet app's own browser.
 *
 * A review link is usually tapped on a phone, in a browser with no wallet in
 * it. Each of these hands the page to the wallet app, where the wallet is
 * simply there. Every format is the wallet's own published one; a wallet
 * with no published format is left out rather than guessed at.
 */

export interface WalletLink {
  /** The service's wallet kind. */
  type: string
  name: string
  href: string
}

const BUILDERS: readonly { type: string; name: string; rdns: string; href: (url: string) => string }[] = [
  { type: 'metamask', name: 'MetaMask', rdns: 'io.metamask', href: (url) => `https://link.metamask.io/dapp/${url.replace(/^https?:\/\//, '')}` },
  { type: 'trust', name: 'Trust Wallet', rdns: 'com.trustwallet.app', href: (url) => `https://link.trustwallet.com/open_url?coin_id=60&url=${encodeURIComponent(url)}` },
  { type: 'coinbase_wallet', name: 'Base', rdns: 'com.coinbase.wallet', href: (url) => `https://go.cb-w.com/dapp?cb_url=${encodeURIComponent(url)}` },
]

/** The wallet the plan's account was linked with leads, when it has a link. */
export function walletLinks(pageUrl: string, preferred?: string): WalletLink[] {
  const links = BUILDERS.map((b) => ({ type: b.type, name: b.name, href: b.href(pageUrl) }))
  return [...links.filter((l) => l.type === preferred), ...links.filter((l) => l.type !== preferred)]
}

/**
 * The open-this-page link of the wallet a registry row names, by the rdns the
 * row carries. For a wallet the registry lists with no pairing link of its
 * own, this is the only way into its app from a phone.
 */
export function appLinkFor(rdns: string | null, pageUrl: string): string | null {
  return BUILDERS.find((b) => b.rdns === rdns)?.href(pageUrl) ?? null
}

export function isPhone(userAgent: string): boolean {
  return /android|iphone|ipad|ipod/i.test(userAgent)
}
