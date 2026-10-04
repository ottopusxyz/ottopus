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

const BUILDERS: readonly { type: string; name: string; href: (url: string) => string }[] = [
  { type: 'metamask', name: 'MetaMask', href: (url) => `https://link.metamask.io/dapp/${url.replace(/^https?:\/\//, '')}` },
  { type: 'trust', name: 'Trust Wallet', href: (url) => `https://link.trustwallet.com/open_url?coin_id=60&url=${encodeURIComponent(url)}` },
]

/** The wallet the plan's account was linked with leads, when it has a link. */
export function walletLinks(pageUrl: string, preferred?: string): WalletLink[] {
  const links = BUILDERS.map((b) => ({ type: b.type, name: b.name, href: b.href(pageUrl) }))
  return [...links.filter((l) => l.type === preferred), ...links.filter((l) => l.type !== preferred)]
}

export function isPhone(userAgent: string): boolean {
  return /android|iphone|ipad|ipod/i.test(userAgent)
}
