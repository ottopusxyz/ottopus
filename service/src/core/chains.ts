import type { Chain } from 'viem'
import * as viemChains from 'viem/chains'
import { CaipError, type ChainId, formatChainId, parseChainId, toEvmChainId } from './caip.js'

/**
 * The chain registry. Ottopus supports most EVM chains, not a chosen two, and
 * this is the one place that answers, for a CAIP-2 id: is it supported, what
 * is it called, what does it spend, where do we read it, where do we link.
 *
 * Built from viem's list, which is maintained upstream and covers several
 * hundred chains. Chains are data: adding one never means touching the
 * decoder, the scorer or the review page. Supported means viem knows it —
 * a chain nobody has described is one we cannot decode or send on.
 */

export interface ChainInfo {
  /** CAIP-2, e.g. eip155:8453. */
  id: string
  evmId: number
  name: string
  nativeCurrency: { name: string; symbol: string; decimals: number }
  /** viem's public endpoints. The fallback when no provider template is set. */
  publicRpcUrls: readonly string[]
  explorerUrl: string | null
  testnet: boolean
}

function isChain(value: unknown): value is Chain {
  return typeof value === 'object' && value !== null && typeof (value as Chain).id === 'number'
}

/** First definition wins where viem exports one chain under two names. */
const BY_EVM_ID: ReadonlyMap<number, Chain> = (() => {
  const map = new Map<number, Chain>()
  for (const chain of Object.values(viemChains)) {
    if (isChain(chain) && !map.has(chain.id)) map.set(chain.id, chain)
  }
  return map
})()

function toInfo(chain: Chain): ChainInfo {
  return {
    id: formatChainId({ namespace: 'eip155', reference: String(chain.id) }),
    evmId: chain.id,
    name: chain.name,
    nativeCurrency: chain.nativeCurrency,
    publicRpcUrls: chain.rpcUrls.default.http,
    explorerUrl: chain.blockExplorers?.default.url ?? null,
    testnet: chain.testnet === true,
  }
}

/** The chain, or null. Non-EVM namespaces are simply not here. */
export function findChain(chain: ChainId | string): ChainInfo | null {
  const parsed = typeof chain === 'string' ? parseChainId(chain) : chain
  if (parsed.namespace !== 'eip155') return null
  const found = BY_EVM_ID.get(Number(parsed.reference))
  return found ? toInfo(found) : null
}

export function isSupportedChain(chain: ChainId | string): boolean {
  return findChain(chain) !== null
}

/**
 * The chain, or a refusal that names it. Never a silent fallback to
 * Ethereum: a call meant for a chain we do not know is not a call we can
 * explain, and one we cannot explain is one nobody should sign.
 */
export function requireChain(chain: ChainId | string): ChainInfo {
  const info = findChain(chain)
  if (!info) {
    const id = typeof chain === 'string' ? chain : formatChainId(chain)
    throw new CaipError(`chain ${id} is not one Ottopus knows`)
  }
  return info
}

export function chainName(chain: ChainId | string): string {
  return findChain(chain)?.name ?? (typeof chain === 'string' ? chain : formatChainId(chain))
}

/** The placeholder a provider template must carry. */
export const RPC_TEMPLATE_SLOT = '{chainId}'

/**
 * Where to read this chain.
 *
 * With a provider template — one key in config, the EVM id substituted — every
 * chain goes through the same paid endpoint, which is what rate limits and
 * reliability need. Without one, viem's public RPC for the chain. Never a
 * hand-maintained list of URLs.
 */
export function rpcUrlFor(chain: ChainId | string, template?: string): string {
  const info = requireChain(chain)
  if (template) return template.replaceAll(RPC_TEMPLATE_SLOT, String(info.evmId))
  const url = info.publicRpcUrls[0]
  if (!url) throw new CaipError(`chain ${info.id} (${info.name}) has no public RPC and no template is set`)
  return url
}

export function explorerTxUrl(chain: ChainId | string, txHash: string): string | null {
  const base = findChain(chain)?.explorerUrl
  return base ? `${base}/tx/${txHash}` : null
}

export function explorerAddressUrl(chain: ChainId | string, address: string): string | null {
  const base = findChain(chain)?.explorerUrl
  return base ? `${base}/address/${address}` : null
}

/** The viem chain object, for building a client. */
export function viemChainFor(chain: ChainId | string): Chain {
  const info = requireChain(chain)
  return BY_EVM_ID.get(info.evmId)!
}

/** Every chain the registry knows, mainnets first. */
export function listChains(): ChainInfo[] {
  return [...BY_EVM_ID.values()]
    .map(toInfo)
    .sort((a, b) => Number(a.testnet) - Number(b.testnet) || a.evmId - b.evmId)
}

export { toEvmChainId }
