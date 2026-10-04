'use client'

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { createInjectedStore, type InjectedStore, type InjectedWallet } from './injected'
import { caip2OfHex, readConnection, requestConnection, type Held } from './signer'

/**
 * The wallet this page connected by itself, straight to the wallet's own
 * provider. One wallet at a time; choosing another replaces it.
 */
export interface Signer extends Held {
  wallet: InjectedWallet
}

export interface UseSigner {
  /** Wallets installed in this browser. */
  installed: readonly InjectedWallet[]
  signer: Signer | null
  /**
   * Opens the wallet. Call from a click. Null when a later call replaced this
   * one before the wallet answered: its answer is dropped, not connected.
   */
  connect: (wallet: InjectedWallet) => Promise<Held | null>
  /** Re-read the account and chain, for after a switch the wallet did not announce. */
  refresh: () => Promise<void>
}

/** Which wallet to look at again on reload. An rdns, nothing about the account. */
const REMEMBERED = 'ottopus.review.wallet'
const NONE: readonly InjectedWallet[] = []

let store: InjectedStore | null = null
const browserStore = () => (store ??= createInjectedStore(window))
const subscribe = (listener: () => void) => browserStore().subscribe(listener)
const snapshot = () => browserStore().get()
const serverSnapshot = () => NONE

export function useSigner(): UseSigner {
  const installed = useSyncExternalStore(subscribe, snapshot, serverSnapshot)
  const [signer, setSigner] = useState<Signer | null>(null)

  // A reload should not cost a reconnect. `eth_accounts` never prompts: it
  // answers only if the wallet still allows this page.
  useEffect(() => {
    if (signer) return
    const wallet = installed.find((w) => w.rdns === remembered())
    if (!wallet) return
    let live = true
    void readConnection(wallet.provider)
      .then((held) => {
        if (live && held) setSigner({ wallet, ...held })
      })
      .catch(() => {})
    return () => {
      live = false
    }
  }, [installed, signer])

  // The wallet is where accounts and chains change; the page only follows.
  const wallet = signer?.wallet
  useEffect(() => {
    if (!wallet) return
    const { provider } = wallet
    const onAccounts = (accounts: string[]) => {
      if (accounts.length === 0) {
        forget()
        setSigner(null)
        return
      }
      setSigner((held) => (held ? { ...held, accounts } : held))
    }
    const onChain = (hex: string) => setSigner((held) => (held ? { ...held, chainId: caip2OfHex(hex) } : held))
    provider.on?.('accountsChanged', onAccounts)
    provider.on?.('chainChanged', onChain)
    return () => {
      provider.removeListener?.('accountsChanged', onAccounts)
      provider.removeListener?.('chainChanged', onChain)
    }
  }, [wallet])

  // A wallet's request cannot be withdrawn, so a person who gives up on one
  // wallet and opens another leaves the first still pending. The last wallet
  // asked is the only one whose answer counts.
  const asked = useRef(0)
  const connect = useCallback(async (wallet: InjectedWallet) => {
    const mine = ++asked.current
    const held = await requestConnection(wallet.provider)
    if (mine !== asked.current) return null
    remember(wallet.rdns)
    setSigner({ wallet, ...held })
    return held
  }, [])

  const refresh = useCallback(async () => {
    if (!wallet) return
    const held = await readConnection(wallet.provider)
    if (held) setSigner({ wallet, ...held })
  }, [wallet])

  return { installed, signer, connect, refresh }
}

// Storage can be refused outright in a private window; forgetting is fine.
function remembered(): string | null {
  try {
    return window.localStorage.getItem(REMEMBERED)
  } catch {
    return null
  }
}

function remember(rdns: string) {
  try {
    window.localStorage.setItem(REMEMBERED, rdns)
  } catch {}
}

function forget() {
  try {
    window.localStorage.removeItem(REMEMBERED)
  } catch {}
}
