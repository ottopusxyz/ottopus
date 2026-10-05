import { installedConnector, type InjectedWallet } from './installed'
import { SDK_WALLETS } from './sdk'
import type { Connector } from './types'
import { WC_ID, walletConnectConnector } from './walletconnect'

/**
 * The connector a remembered id names, for restoring after a reload. Null
 * when it is not available here: an extension since removed or not announced
 * yet, or WalletConnect with no project id.
 */
export function connectorFor(
  id: string | null,
  installed: readonly InjectedWallet[],
  projectId: string | null,
): Connector | null {
  if (!id) return null
  const here = installed.find((w) => w.rdns === id)
  if (here) return installedConnector(here)
  if (id === WC_ID) return projectId ? walletConnect(projectId) : null
  return SDK_WALLETS.find((w) => w.connector.id === id)?.connector ?? null
}

// One per project id, so the wallet the page holds keeps one connector.
let wc: { projectId: string; connector: Connector } | null = null

export function walletConnect(projectId: string): Connector {
  if (wc?.projectId !== projectId) wc = { projectId, connector: walletConnectConnector(projectId) }
  return wc.connector
}

export type { ConnectedWallet, Connection, Connector, ConnectorKind, ConnectOptions, WalletFace, WalletProvider } from './types'
export { createInjectedStore, installedConnector, installedFor, type InjectedStore, type InjectedWallet } from './installed'
export { walletConnectProjectId } from './walletconnect'
export { preloadSdkWallets, sdkWalletFor, type SdkWallet } from './sdk'
export { routeFor, routeForSdk, sdkWalletLinked, sdkWalletsHere, type Route } from './route'
export { DIRECTORY_PAGE_SIZE, fetchDirectory, pairingLink, type DirectoryWallet } from './directory'
export { isPhone, walletLinks, type WalletLink } from './links'
export { caip2OfHex, describeConnectError, needsSwitch, readConnection, rereadHeld, switchTo, type Held } from './provider'
