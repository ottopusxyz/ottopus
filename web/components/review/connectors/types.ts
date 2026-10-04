import type { Eip1193 } from '../send-calls'
import type { Held } from './provider'

/**
 * One shape for every way a wallet reaches this page. There are three, and a
 * new wallet is always one of them:
 *
 * - `installed`: in this browser, found by EIP-6963. No per-wallet code.
 * - `walletconnect`: on another device, paired over the relay. No per-wallet
 *   code either; the registry names the wallets.
 * - `sdk`: a wallet with a window of its own that only its vendor's SDK can
 *   open. One small file each, listed in `sdk/index.ts`.
 *
 * A connector only ever produces a candidate. The address-and-chain gate
 * decides who may sign, whichever connector the wallet came through.
 */
export type ConnectorKind = 'installed' | 'walletconnect' | 'sdk'

export interface WalletProvider extends Eip1193 {
  on?(event: string, listener: (...args: never[]) => void): unknown
  removeListener?(event: string, listener: (...args: never[]) => void): unknown
}

/** Name and logo to show for a wallet. A label, never an authority. */
export interface WalletFace {
  name: string
  icon: string | null
}

/** A wallet the page holds, and the connector that reached it. */
export interface ConnectedWallet extends WalletFace {
  connector: Connector
  provider: WalletProvider
}

export interface Connection {
  wallet: ConnectedWallet
  held: Held
}

export interface ConnectOptions {
  /** CAIP-2 the plan runs on; a session or account is opened for it. */
  chain: string
  /** The wallet the person picked from a list, when the connector cannot name it itself. */
  face?: WalletFace | null | undefined
  /** Handed the pairing code to draw. Only a `walletconnect` connector calls it. */
  onUri?: ((uri: string) => void) | undefined
}

export interface Connector {
  /** What is remembered across a reload: an rdns for an installed wallet, a fixed marker otherwise. */
  id: string
  kind: ConnectorKind
  /** Opens the wallet. Only ever called from a click. */
  connect(opts: ConnectOptions): Promise<Connection>
  /** What a reload left behind, without prompting. Null when there is nothing. */
  restore(opts: Pick<ConnectOptions, 'chain'>): Promise<Connection | null>
  /** End the connection on the wallet's side. Best effort; the page lets go regardless. */
  disconnect(wallet: ConnectedWallet): Promise<void>
}
