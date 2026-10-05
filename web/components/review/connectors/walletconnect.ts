import { evmIdOf, findChain } from '@/lib/chains'
import { readConnection, type Held } from './provider'
import type { ConnectedWallet, Connector, WalletFace, WalletProvider } from './types'

/**
 * A wallet that is not in this browser, reached over WalletConnect: the page
 * shows a pairing code, the wallet app scans or opens it, and from then on the
 * session answers like any other provider. No modal of the vendor's is ever
 * opened; the code is drawn in our own dialog.
 *
 * What connects here is still only a candidate. The address-and-chain gate
 * decides who may sign, exactly as it does for an installed wallet.
 */

/** Stands where an installed wallet's rdns would, for remembering across a reload. */
export const WC_ID = 'walletconnect'

/**
 * The Reown project id. Public by design, like the sign-in app id: it names
 * the app to the relay and is visible in the browser. Null when unset, and
 * the page then offers no WalletConnect at all rather than a button that
 * cannot work.
 */
export function walletConnectProjectId(): string | null {
  return process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID?.trim() || null
}

export interface WcProvider extends WalletProvider {
  connect(opts?: { optionalChains?: number[]; rpcMap?: Record<string, string> }): Promise<void>
  disconnect(): Promise<void>
  session?: { peer?: { metadata?: { name?: string } } } | undefined
}

export type WcInit = (opts: { projectId: string; evmId: number; rpcMap: Record<string, string> }) => Promise<WcProvider>

export interface WcOptions {
  projectId: string
  /** CAIP-2 the plan runs on; the session is proposed for it. */
  chain: string
  /** Replaced in tests. */
  init?: WcInit
}

// Loaded on first use: the relay client is large, and most people sign with a
// wallet that is already in the browser.
const browserInit: WcInit = async ({ projectId, evmId, rpcMap }) => {
  const { EthereumProvider } = await import('@walletconnect/ethereum-provider')
  const provider = await EthereumProvider.init({
    projectId,
    optionalChains: [evmId],
    rpcMap,
    showQrModal: false,
    metadata: {
      name: 'Ottopus',
      description: 'Review and sign what your agent prepared.',
      url: window.location.origin,
      icons: [`${window.location.origin}/icon.svg`],
    },
  })
  return provider as unknown as WcProvider
}

// One relay client per page. A second `init` would open a second socket and
// two clients would race over the same stored session.
let shared: { init: WcInit; provider: Promise<WcProvider> } | null = null

function target(chain: string): { evmId: number; rpcMap: Record<string, string> } {
  const evmId = evmIdOf(chain)
  if (evmId === null) throw new Error(`${chain} is not a chain a wallet can connect on`)
  const rpc = findChain(chain)?.rpcUrls[0]
  return { evmId, rpcMap: rpc ? { [evmId]: rpc } : {} }
}

function providerFor(opts: WcOptions): Promise<WcProvider> {
  const init = opts.init ?? browserInit
  if (shared?.init === init) return shared.provider
  const provider = init({ projectId: opts.projectId, ...target(opts.chain) })
  shared = { init, provider }
  // A failed start must not be the answer to every later attempt.
  provider.catch(() => {
    if (shared?.provider === provider) shared = null
  })
  return provider
}

export interface Paired {
  provider: WcProvider
  held: Held
}

// One proposal at a time. The client keeps a single session, so a second
// proposal beside a pending one would leave two wallets racing to fill it.
interface Pairing {
  provider: WcProvider
  chain: string
  uri: string | null
  watchers: Set<(uri: string) => void>
  done: Promise<Paired>
}
let pending: Pairing | null = null

function propose(provider: WcProvider, chain: string): Pairing {
  const pairing: Pairing = { provider, chain, uri: null, watchers: new Set(), done: null as never }
  const onUri = (uri: string) => {
    pairing.uri = uri
    for (const watch of pairing.watchers) watch(uri)
  }
  pending = pairing
  pairing.done = (async () => {
    try {
      // Any earlier session is ended first: one wallet at a time, and a stale
      // session must not answer for a wallet the person has moved on from.
      if (provider.session) await provider.disconnect().catch(() => {})
      provider.on?.('display_uri', onUri)
      const { evmId, rpcMap } = target(chain)
      await provider.connect({ optionalChains: [evmId], rpcMap })
    } finally {
      provider.removeListener?.('display_uri', onUri)
      if (pending === pairing) pending = null
    }
    const held = await readConnection(provider)
    if (!held) throw new Error('The wallet connected without sharing an account.')
    return { provider, held }
  })()
  return pairing
}

/**
 * Pair a wallet. `onUri` is handed the code to draw as soon as the relay has
 * one; the promise settles when the wallet approves or refuses. Only ever
 * called from a click.
 *
 * A pairing cannot be withdrawn once proposed, and its code is not tied to
 * any one wallet app. So asking again while one is still open joins it: the
 * same code is handed over and the same answer awaited, rather than a second
 * proposal being opened beside the first.
 */
export async function pairWalletConnect(opts: WcOptions & { onUri: (uri: string) => void }): Promise<Paired> {
  const provider = await providerFor(opts)
  // A proposal for another chain has to finish before this one can be made.
  while (pending && (pending.provider !== provider || pending.chain !== opts.chain)) await pending.done.catch(() => {})
  const pairing = pending ?? propose(provider, opts.chain)
  pairing.watchers.add(opts.onUri)
  if (pairing.uri) opts.onUri(pairing.uri)
  return pairing.done
}

/** The session a reload left behind, without prompting. Null when there is none. */
export async function restoreWalletConnect(opts: WcOptions): Promise<Paired | null> {
  const provider = await providerFor(opts)
  if (!provider.session) return null
  const held = await readConnection(provider)
  return held ? { provider, held } : null
}

/**
 * The connector for a wallet on another device. The paired wallet is named as
 * the person picked it, else as it called itself; like every wallet name here
 * that is a label, never an authority.
 */
export function walletConnectConnector(projectId: string, init?: WcInit): Connector {
  const base = init ? { projectId, init } : { projectId }
  const walletOf = (provider: WcProvider, face?: WalletFace | null): ConnectedWallet => {
    const said = provider.session?.peer?.metadata?.name
    return {
      connector,
      name: face?.name ?? (typeof said === 'string' && said.trim() ? said.trim() : 'WalletConnect'),
      icon: face?.icon ?? null,
      provider,
    }
  }
  const connector: Connector = {
    id: WC_ID,
    kind: 'walletconnect',
    async connect({ chain, face, onUri }) {
      const paired = await pairWalletConnect({ ...base, chain, onUri: (uri) => onUri?.(uri) })
      return { wallet: walletOf(paired.provider, face), held: paired.held }
    },
    async restore({ chain }) {
      const paired = await restoreWalletConnect({ ...base, chain })
      return paired ? { wallet: walletOf(paired.provider), held: paired.held } : null
    },
    disconnect: (wallet) => (wallet.provider as WcProvider).disconnect(),
  }
  return connector
}

/** Forget the shared client. Tests only. */
export function resetWalletConnect() {
  shared = null
  pending = null
}
