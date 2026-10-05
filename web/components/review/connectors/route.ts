import { pairingLink, type DirectoryWallet } from './directory'
import { appLinkFor } from './links'
import { SDK_WALLETS, sdkWalletFor, type SdkWallet } from './sdk'

/** How a wallet that is not installed here gets connected. */
export type Route =
  /** Leave for the wallet's app, which opens this page with the wallet simply there. */
  | { via: 'app-link'; href: string }
  | { via: 'sdk'; wallet: SdkWallet }
  | { via: 'walletconnect' }

export interface Where {
  onPhone: boolean
  pageUrl: string
}

/**
 * Which way an SDK wallet goes, by its own registration: its app when it asks
 * for that on this kind of device and has a published link, else its window.
 */
export function routeForSdk(wallet: SdkWallet, where: Where): Route {
  if (wallet.route[where.onPhone ? 'phone' : 'desktop'] === 'app-link') {
    for (const rdns of wallet.rdns) {
      const href = appLinkFor(rdns, where.pageUrl)
      if (href) return { via: 'app-link', href }
    }
  }
  return { via: 'sdk', wallet }
}

/**
 * Which way a picked wallet goes. `choice` is the registry row; null is
 * "whatever is on my phone", which any wallet app can scan.
 *
 * A wallet with a connector of its own goes where its registration says,
 * whatever links the registry lists for it. For the rest, pairing leads
 * whenever the registry gives a link to hand the code to. A wallet listed
 * with none cannot be paired by link: on a phone its app opens this page
 * instead, and otherwise the code is still drawn for the app to scan.
 */
export function routeFor(choice: DirectoryWallet | null, where: Where): Route {
  if (!choice) return { via: 'walletconnect' }
  const own = sdkWalletFor(choice.rdns)
  if (own) return routeForSdk(own, where)
  if (pairingLink(choice, '')) return { via: 'walletconnect' }
  const href = appLinkFor(choice.rdns, where.pageUrl)
  return href && where.onPhone ? { via: 'app-link', href } : { via: 'walletconnect' }
}

/**
 * The SDK wallets that get a row of their own in the picker: the ones whose
 * window opens here. One that leaves for its app is listed with the other
 * app links instead.
 */
export function sdkWalletsHere(where: Where): SdkWallet[] {
  return SDK_WALLETS.filter((wallet) => routeForSdk(wallet, where).via === 'sdk')
}

/**
 * The SDK wallet the plan's account was linked with, if its window opens
 * here. Like `installedFor`, the kind is display metadata that may be stale:
 * this only picks which wallet the button opens first, never who may sign.
 */
export function sdkWalletLinked(walletType: string | undefined, where: Where): SdkWallet | null {
  if (!walletType) return null
  return sdkWalletsHere(where).find((wallet) => wallet.walletTypes.includes(walletType)) ?? null
}
