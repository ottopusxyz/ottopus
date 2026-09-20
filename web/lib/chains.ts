import type { Chain } from 'viem'
import * as viemChains from 'viem/chains'

/**
 * The web's view of the chain registry: the same list the service reads
 * (#81), used here only for words and for the wallet — a chain's name, its
 * explorer, and the parameters `wallet_addEthereumChain` needs when a wallet
 * has never heard of it. Nothing here is a source of truth about a plan.
 */

export interface ChainWords {
  /** CAIP-2. */
  id: string
  evmId: number
  name: string
  nativeCurrency: { name: string; symbol: string; decimals: number }
  explorerUrl: string | null
  rpcUrls: readonly string[]
}

function isChain(value: unknown): value is Chain {
  return typeof value === 'object' && value !== null && typeof (value as Chain).id === 'number'
}

/** A mainnet wins a shared id; between two of a kind, the first export. */
const BY_EVM_ID: ReadonlyMap<number, Chain> = (() => {
  const map = new Map<number, Chain>()
  for (const chain of Object.values(viemChains)) {
    if (!isChain(chain)) continue
    const held = map.get(chain.id)
    if (!held || (held.testnet === true && chain.testnet !== true)) map.set(chain.id, chain)
  }
  return map
})()

/**
 * Every mainnet the registry knows, for the wallet provider's supported
 * list. Privy refuses to switch to a chain outside it before the wallet is
 * even asked, and its default list is a handful — so a swap on any chain
 * the portfolio can read has to be one Privy will switch to. Base leads:
 * Privy treats the first entry as the default when none is named, and
 * naming one makes it prompt every wallet to switch on connect.
 */
export const WALLET_CHAINS: readonly Chain[] = (() => {
  const mainnets = [...BY_EVM_ID.values()].filter((chain) => chain.testnet !== true)
  const base = mainnets.find((chain) => chain.id === 8453)
  const rest = mainnets.filter((chain) => chain.id !== 8453).sort((a, b) => a.id - b.id)
  return base ? [base, ...rest] : rest
})()

export function evmIdOf(caip2: string): number | null {
  const m = /^eip155:(\d+)$/.exec(caip2)
  return m ? Number(m[1]) : null
}

export function findChain(caip2: string): ChainWords | null {
  const evmId = evmIdOf(caip2)
  const chain = evmId === null ? undefined : BY_EVM_ID.get(evmId)
  if (!chain) return null
  return {
    id: caip2,
    evmId: chain.id,
    name: chain.name,
    nativeCurrency: chain.nativeCurrency,
    explorerUrl: chain.blockExplorers?.default.url ?? null,
    rpcUrls: chain.rpcUrls.default.http,
  }
}

/**
 * The viem chain object itself, for building a client. `findChain` gives
 * words; this gives the thing viem needs, including the default RPC the
 * browser's own simulation reads through.
 */
export function rawChain(caip2: string): Chain | null {
  const evmId = evmIdOf(caip2)
  return (evmId === null ? undefined : BY_EVM_ID.get(evmId)) ?? null
}

export function chainName(caip2: string): string {
  return findChain(caip2)?.name ?? caip2
}

export function explorerTxUrl(caip2: string, txHash: string): string | null {
  const base = findChain(caip2)?.explorerUrl
  return base ? `${base}/tx/${txHash}` : null
}

export function explorerAddressUrl(caip2: string, address: string): string | null {
  const base = findChain(caip2)?.explorerUrl
  return base ? `${base}/address/${address}` : null
}

/** EIP-3085 parameters, for a wallet that does not know the chain. */
export function addChainParams(caip2: string) {
  const chain = findChain(caip2)
  if (!chain) return null
  return {
    chainId: `0x${chain.evmId.toString(16)}`,
    chainName: chain.name,
    nativeCurrency: chain.nativeCurrency,
    rpcUrls: [...chain.rpcUrls],
    ...(chain.explorerUrl ? { blockExplorerUrls: [chain.explorerUrl] } : {}),
  }
}

export function hexChainId(caip2: string): `0x${string}` | null {
  const evmId = evmIdOf(caip2)
  return evmId === null ? null : `0x${evmId.toString(16)}`
}
