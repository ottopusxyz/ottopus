import { evmIdOf } from '@/lib/chains'
import { readConnection, requestConnection, type Held } from '../provider'
import type { ConnectedWallet, Connector, WalletFace, WalletProvider } from '../types'
import type { SdkWallet } from './types'

/**
 * Base's own web wallet: a passkey account that lives at keys.coinbase.com
 * and answers through a window of its own, with nothing installed and no
 * phone involved. The registry lists Base with no link to hand a pairing code
 * to, so on a desktop this is the only way it connects.
 *
 * What connects here is still only a candidate. The address-and-chain gate
 * decides who may sign, exactly as it does for an installed wallet.
 */

/** Stands where an installed wallet's rdns would, for remembering across a reload. */
export const BASE_ID = 'base-account'

export interface BaseProvider extends WalletProvider {
  disconnect(): Promise<void>
}

export type BaseInit = (opts: { evmId: number }) => Promise<BaseProvider>

export interface BaseOptions {
  /** CAIP-2 the plan runs on; the account is opened on it. */
  chain: string
  /** Replaced in tests. */
  init?: BaseInit
}

const load = () => import('@base-org/account/browser')

// Loaded on first use: most people sign with a wallet already in the browser.
const browserInit: BaseInit = async ({ evmId }) => {
  const { createBaseAccountSDK } = await load()
  const sdk = createBaseAccountSDK({
    appName: 'Ottopus',
    appLogoUrl: `${window.location.origin}/icon.svg`,
    appChainIds: [evmId],
    preference: { telemetry: false },
  })
  return sdk.getProvider() as unknown as BaseProvider
}

// One provider per page: its account lives in storage, and two would race over it.
let shared: { init: BaseInit; provider: Promise<BaseProvider> } | null = null

function providerFor(opts: BaseOptions): Promise<BaseProvider> {
  const init = opts.init ?? browserInit
  if (shared?.init === init) return shared.provider
  const evmId = evmIdOf(opts.chain)
  if (evmId === null) throw new Error(`${opts.chain} is not a chain a wallet can connect on`)
  const provider = init({ evmId })
  shared = { init, provider }
  // A failed start must not be the answer to every later attempt.
  provider.catch(() => {
    if (shared?.provider === provider) shared = null
  })
  return provider
}

export interface Opened {
  provider: BaseProvider
  held: Held
}

/** Opens Base's window and asks for an account. Only ever called from a click. */
export async function openBaseAccount(opts: BaseOptions): Promise<Opened> {
  const provider = await providerFor(opts)
  return { provider, held: await requestConnection(provider) }
}

/** The account a reload left behind, without prompting. Null when there is none. */
export async function restoreBaseAccount(opts: BaseOptions): Promise<Opened | null> {
  const provider = await providerFor(opts)
  const held = await readConnection(provider)
  return held ? { provider, held } : null
}

export function baseAccountConnector(init?: BaseInit): Connector {
  const walletOf = (provider: BaseProvider, face?: WalletFace | null): ConnectedWallet => ({
    connector,
    name: face?.name ?? 'Base',
    icon: face?.icon ?? null,
    provider,
  })
  const connector: Connector = {
    id: BASE_ID,
    kind: 'sdk',
    async connect({ chain, face }) {
      const opened = await openBaseAccount(init ? { chain, init } : { chain })
      return { wallet: walletOf(opened.provider, face), held: opened.held }
    },
    async restore({ chain }) {
      const opened = await restoreBaseAccount(init ? { chain, init } : { chain })
      return opened ? { wallet: walletOf(opened.provider), held: opened.held } : null
    },
    disconnect: (wallet) => (wallet.provider as BaseProvider).disconnect(),
  }
  return connector
}

export const baseAccount: SdkWallet = {
  name: 'Base',
  icon: null,
  connector: baseAccountConnector(),
  // A phone has the Base app, where the wallet is simply there; a desktop has only the window.
  route: { desktop: 'sdk', phone: 'app-link' },
  // The registry row for Base carries its extension's rdns.
  rdns: ['com.coinbase.wallet'],
  preload: () => void load().catch(() => {}),
}

/** Forget the shared provider. Tests only. */
export function resetBaseAccount() {
  shared = null
}
