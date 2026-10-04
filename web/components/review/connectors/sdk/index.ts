import { baseAccount } from './base-account'
import type { SdkWallet } from './types'

/**
 * Every wallet with a connector of its own. Adding one is a file beside
 * `base-account.ts` that exports an `SdkWallet`, and a line here; its row in
 * the picker, routing, restoring and disconnecting follow from the list.
 */
export const SDK_WALLETS: readonly SdkWallet[] = [baseAccount]

/** The SDK wallet a registry row names, by the rdns the row carries. */
export function sdkWalletFor(rdns: string | null): SdkWallet | null {
  return SDK_WALLETS.find((w) => rdns !== null && w.rdns.includes(rdns)) ?? null
}

export function preloadSdkWallets() {
  for (const wallet of SDK_WALLETS) wallet.preload()
}

export type { SdkRoute, SdkWallet } from './types'
