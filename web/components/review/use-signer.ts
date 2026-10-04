'use client'

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import {
  caip2OfHex,
  connectorFor,
  createInjectedStore,
  rereadHeld,
  walletConnect as walletConnectFor,
  walletConnectProjectId,
  type ConnectedWallet,
  type Connection,
  type Connector,
  type Held,
  type InjectedStore,
  type InjectedWallet,
  type WalletFace,
} from './connectors'

/**
 * The wallet this page connected by itself: an installed one through its own
 * provider, one elsewhere through a WalletConnect session, or Base's web
 * wallet through its own window. One wallet at a time; choosing another
 * replaces it.
 */
export interface Signer extends Held {
  wallet: ConnectedWallet
}

export interface UseSigner {
  /** Wallets installed in this browser. */
  installed: readonly InjectedWallet[]
  signer: Signer | null
  /**
   * Opens a wallet through its connector. Call from a click. `face` names a
   * wallet picked from a list; `onUri` is handed a pairing code to draw. Null
   * when a later call replaced this one before the wallet answered: its
   * answer is dropped, not connected.
   */
  connect: (
    connector: Connector,
    opts?: { face?: WalletFace | null | undefined; onUri?: ((uri: string) => void) | undefined },
  ) => Promise<Connection | null>
  /**
   * The connector for a wallet that is not installed here. Null until the
   * public project id is configured.
   */
  walletConnect: Connector | null
  /** Re-read the account and chain, for after a switch the wallet did not announce. */
  refresh: () => Promise<void>
  /**
   * Let go of the connected wallet: nothing is restored on reload, and a
   * request still pending in a wallet no longer connects.
   */
  disconnect: () => void
}

/** Which connector to look at again on reload, by its id. Nothing about the account. */
const REMEMBERED = 'ottopus.review.wallet'
const NONE: readonly InjectedWallet[] = []

let store: InjectedStore | null = null
const browserStore = () => (store ??= createInjectedStore(window))
const subscribe = (listener: () => void) => browserStore().subscribe(listener)
const snapshot = () => browserStore().get()
const serverSnapshot = () => NONE

/** `chain` is the CAIP-2 the plan runs on; a pairing is proposed for it. */
export function useSigner(chain: string): UseSigner {
  const installed = useSyncExternalStore(subscribe, snapshot, serverSnapshot)
  const [signer, setSigner] = useState<Signer | null>(null)
  // The wallet held right now, for callbacks made before it was: a refresh
  // asked for on the back of a connect must read the wallet just connected.
  const holding = useRef<ConnectedWallet | null>(null)
  const hold = useCallback((next: Signer | null) => {
    holding.current = next?.wallet ?? null
    setSigner(next)
  }, [])

  // A reload should not cost a reconnect. Restoring never prompts: an
  // installed wallet answers only if it still allows this page, and a session
  // or SDK account is read back from storage.
  const projectId = walletConnectProjectId()
  useEffect(() => {
    if (signer) return
    const connector = connectorFor(remembered(), installed, projectId)
    if (!connector) return
    let live = true
    void connector
      .restore({ chain })
      .then((found) => {
        if (!live) return
        if (found) hold({ wallet: found.wallet, ...found.held })
        // An extension may only be locked; a session that is gone is gone.
        else if (connector.kind !== 'installed') forget()
      })
      .catch(() => {})
    return () => {
      live = false
    }
  }, [installed, signer, projectId, chain, hold])

  // The wallet is where accounts and chains change; the page only follows.
  const wallet = signer?.wallet
  useEffect(() => {
    if (!wallet) return
    const { provider } = wallet
    const onAccounts = (accounts: string[]) => {
      if (accounts.length === 0) {
        forget()
        hold(null)
        return
      }
      setSigner((held) => (held ? { ...held, accounts } : held))
    }
    const onChain = (hex: string) => setSigner((held) => (held ? { ...held, chainId: caip2OfHex(hex) } : held))
    // Only a session can end from the far side. An installed wallet's
    // "disconnect" means it lost its node, which is not the person leaving.
    const onEnded = () => {
      forget()
      hold(null)
    }
    const paired = wallet.connector.kind !== 'installed'
    provider.on?.('accountsChanged', onAccounts)
    provider.on?.('chainChanged', onChain)
    if (paired) provider.on?.('disconnect', onEnded)
    return () => {
      provider.removeListener?.('accountsChanged', onAccounts)
      provider.removeListener?.('chainChanged', onChain)
      if (paired) provider.removeListener?.('disconnect', onEnded)
    }
  }, [wallet, hold])

  // A wallet's request cannot be withdrawn, so a person who gives up on one
  // wallet and opens another leaves the first still pending. The last wallet
  // asked is the only one whose answer counts.
  const asked = useRef(0)
  const connect = useCallback<UseSigner['connect']>(
    async (connector, opts = {}) => {
      const mine = ++asked.current
      const found = await connector.connect({
        chain,
        face: opts.face,
        onUri: (uri) => {
          if (mine === asked.current) opts.onUri?.(uri)
        },
      })
      if (mine !== asked.current) return null
      remember(connector.id)
      hold({ wallet: found.wallet, ...found.held })
      return found
    },
    [chain, hold],
  )

  const refresh = useCallback(async () => {
    const found = await rereadHeld(() => holding.current)
    if (found) hold({ wallet: found.wallet, ...found.held })
  }, [hold])

  const disconnect = useCallback(() => {
    asked.current++
    forget()
    hold(null)
    if (wallet) void wallet.connector.disconnect(wallet).catch(() => {})
  }, [wallet, hold])

  const walletConnect = projectId ? walletConnectFor(projectId) : null
  return { installed, signer, connect, walletConnect, refresh, disconnect }
}

// Storage can be refused outright in a private window; forgetting is fine.
function remembered(): string | null {
  try {
    return window.localStorage.getItem(REMEMBERED)
  } catch {
    return null
  }
}

function remember(id: string) {
  try {
    window.localStorage.setItem(REMEMBERED, id)
  } catch {}
}

function forget() {
  try {
    window.localStorage.removeItem(REMEMBERED)
  } catch {}
}
