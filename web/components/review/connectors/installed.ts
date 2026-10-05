import { readConnection, requestConnection, revokeConnection } from './provider'
import type { Connector, WalletProvider } from './types'

/**
 * The wallets this browser actually has, found the way EIP-6963 says to: the
 * page asks, and every installed wallet announces itself with a name, an icon
 * and its own provider. No list of a hundred wallets to scroll, and no fight
 * over `window.ethereum` when two extensions are installed.
 *
 * What a wallet says about itself here is a label, never an authority. The
 * address-and-chain gate decides who may sign, whatever the wallet is called.
 */

export type InjectedProvider = WalletProvider

export interface InjectedWallet {
  /** Reverse-DNS the wallet names itself by, "io.metamask". */
  rdns: string
  name: string
  /** A data URI the wallet announced, or null when it offered anything else. */
  icon: string | null
  provider: InjectedProvider
}

export interface InjectedStore {
  subscribe(listener: () => void): () => void
  get(): readonly InjectedWallet[]
}

function walletOf(detail: unknown): InjectedWallet | null {
  const d = detail as { info?: { rdns?: unknown; name?: unknown; icon?: unknown }; provider?: { request?: unknown } } | null
  const info = d?.info
  if (!info || typeof info.rdns !== 'string' || typeof info.name !== 'string' || !info.rdns || !info.name) return null
  if (typeof d.provider?.request !== 'function') return null
  // Only an inline image is rendered: a remote icon would let an extension
  // make this page fetch a URL of its choosing.
  const icon = typeof info.icon === 'string' && info.icon.startsWith('data:image/') ? info.icon : null
  return { rdns: info.rdns, name: info.name, icon, provider: d.provider as InjectedProvider }
}

/**
 * Starts listening on the first subscriber and asks once. One entry per rdns:
 * wallets re-announce on every request, and the list must not grow with them.
 */
export function createInjectedStore(target: EventTarget): InjectedStore {
  let list: readonly InjectedWallet[] = []
  const listeners = new Set<() => void>()
  let started = false

  const onAnnounce = (event: Event) => {
    const wallet = walletOf((event as CustomEvent).detail)
    if (!wallet || list.some((w) => w.rdns === wallet.rdns)) return
    list = [...list, wallet]
    for (const listener of listeners) listener()
  }

  return {
    subscribe(listener) {
      listeners.add(listener)
      if (!started) {
        started = true
        target.addEventListener('eip6963:announceProvider', onAnnounce)
        target.dispatchEvent(new Event('eip6963:requestProvider'))
      }
      return () => {
        listeners.delete(listener)
      }
    },
    get: () => list,
  }
}

/**
 * The stored wallet kind to the rdns that wallet announces.
 *
 * Keys are the service's WALLET_TYPES. A kind with no entry has no extension
 * to find — Safe, Ledger, WalletConnect — and falls through to the picker.
 */
const RDNS: Readonly<Record<string, readonly string[]>> = {
  metamask: ['io.metamask', 'io.metamask.flask'],
  rabby_wallet: ['io.rabby'],
  rabby: ['io.rabby'],
  coinbase_wallet: ['com.coinbase.wallet'],
  rainbow: ['me.rainbow'],
  phantom: ['app.phantom'],
  zerion: ['io.zerion.wallet'],
  trust: ['com.trustwallet.app'],
  okx_wallet: ['com.okex.wallet'],
  brave_wallet: ['com.brave.wallet'],
  bitget_wallet: ['com.bitget.web3'],
  binance_wallet: ['com.binance.wallet'],
  backpack: ['app.backpack'],
  uniswap: ['org.uniswap.app'],
  ambire: ['com.ambire.wallet'],
}

/**
 * The installed wallet the plan's account was linked with, if it is here.
 *
 * The kind is editable display metadata and may be stale, so this only picks
 * which wallet the button opens first. It never decides who may sign.
 */
export function installedFor(
  walletType: string | undefined,
  installed: readonly InjectedWallet[],
): InjectedWallet | null {
  const wanted = walletType && Object.hasOwn(RDNS, walletType) ? RDNS[walletType] : undefined
  if (!wanted) return null
  return installed.find((w) => wanted.includes(w.rdns)) ?? null
}

// One connector per announced wallet, so the page can tell by identity
// whether the wallet it holds is still the one it asked.
const connectors = new WeakMap<InjectedWallet, Connector>()

/** The connector for a wallet in this browser: its own provider, asked directly. */
export function installedConnector(wallet: InjectedWallet): Connector {
  const known = connectors.get(wallet)
  if (known) return known
  const { provider } = wallet
  const connector: Connector = {
    id: wallet.rdns,
    kind: 'installed',
    connect: async () => ({ wallet: connected, held: await requestConnection(provider) }),
    // `eth_accounts` never prompts: it answers only if the wallet still allows this page.
    async restore() {
      const held = await readConnection(provider)
      return held ? { wallet: connected, held } : null
    },
    disconnect: () => revokeConnection(provider),
  }
  const connected = { connector, name: wallet.name, icon: wallet.icon, provider }
  connectors.set(wallet, connector)
  return connector
}
