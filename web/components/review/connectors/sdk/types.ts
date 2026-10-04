import type { Connector, WalletFace } from '../types'

/** `sdk` opens the wallet's own window; `app-link` leaves for its app, which opens this page. */
export type SdkRoute = 'sdk' | 'app-link'

/**
 * A wallet reached through its vendor's own SDK. It is listed and routed from
 * this registration alone: the registry of other wallets neither has to list
 * it nor gets a say in how it connects.
 */
export interface SdkWallet extends WalletFace {
  connector: Connector
  /** The rdns values a registry row for this wallet may carry. */
  rdns: readonly string[]
  /** How it connects on each kind of device. `app-link` needs a published link, and falls back to `sdk` without one. */
  route: { desktop: SdkRoute; phone: SdkRoute }
  /**
   * Fetch the SDK ahead of the click. A browser only lets a window open on
   * the back of a click, and a download in between can use that up.
   */
  preload(): void
}
