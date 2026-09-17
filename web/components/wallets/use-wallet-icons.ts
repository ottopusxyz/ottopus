'use client'

import { useWallets as usePrivyWallets } from '@privy-io/react-auth'
import { useMemo } from 'react'

/**
 * The wallet's own logo, for each arm connected in this browser, keyed by
 * lowercased address.
 *
 * Privy carries the mark the wallet advertises about itself — EIP-6963 hands
 * over a data URI as part of provider discovery — so this is MetaMask's fox as
 * MetaMask ships it, not a copy of it we would have to keep current.
 *
 * Only arms connected right now appear here. An arm linked from another
 * browser, or a pasted watch-only address, has no connector to ask: it keeps
 * the lettered avatar, which is the honest answer rather than a guess at which
 * client it was.
 *
 * Privy types the icon as a string or an embedded SVG component. Only the
 * string is taken — the component form would have to be rendered rather than
 * pointed at, and a second path for a mark we cannot put in an <img> is not
 * worth carrying.
 *
 * Privy's hooks throw outside their provider, so this belongs to a component
 * already inside one. ArmCard takes the resolved icon as a prop instead: it
 * also renders on the styleguide, where Privy is not configured at all.
 */
export function useWalletIcons(): ReadonlyMap<string, string> {
  const { wallets } = usePrivyWallets()

  return useMemo(() => {
    const icons = new Map<string, string>()
    for (const wallet of wallets) {
      const icon = wallet.meta?.icon
      if (typeof icon === 'string' && icon) icons.set(wallet.address.toLowerCase(), icon)
    }
    return icons
  }, [wallets])
}
