import type { Chain } from 'viem'
import * as viemChains from 'viem/chains'
import { CaipError, type ChainId, formatChainId, nativeAssetOf, parseChainId, toEvmChainId } from './caip.js'

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

/**
 * One entry per id. viem exports some chains under two names, and a few ids
 * are shared outright — 999 is HyperEVM and also two dead testnets. A mainnet
 * always wins a collision; between two of the same kind, the first export.
 * Export order is not a fact about chains, so it decides as little as possible.
 */
const BY_EVM_ID: ReadonlyMap<number, Chain> = (() => {
  const map = new Map<number, Chain>()
  for (const chain of Object.values(viemChains)) {
    if (!isChain(chain)) continue
    const held = map.get(chain.id)
    if (!held || (held.testnet === true && chain.testnet !== true)) map.set(chain.id, chain)
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

/** The placeholders a provider template may carry. One of them is required. */
export const RPC_TEMPLATE_SLOTS = ['{chainId}', '{network}'] as const

/**
 * Alchemy's network names, by EVM chain id. Alchemy routes by subdomain, not by
 * chain id, so `{network}` needs a table; this is that table, and it is the
 * one place a provider's naming lives.
 *
 * Every entry was checked against the live service: a real network answers
 * a bad key with 401, a made-up one does not resolve at all. A chain missing
 * here is not an error — it reads through viem's public RPC instead.
 */
export const ALCHEMY_NETWORK: Readonly<Record<number, string>> = {
  1: 'eth-mainnet',
  10: 'opt-mainnet',
  25: 'cronos-mainnet',
  30: 'rootstock-mainnet',
  56: 'bnb-mainnet',
  100: 'gnosis-mainnet',
  130: 'unichain-mainnet',
  137: 'polygon-mainnet',
  143: 'monad-mainnet',
  146: 'sonic-mainnet',
  204: 'opbnb-mainnet',
  232: 'lens-mainnet',
  252: 'frax-mainnet',
  288: 'boba-mainnet',
  324: 'zksync-mainnet',
  360: 'shape-mainnet',
  480: 'worldchain-mainnet',
  592: 'astar-mainnet',
  747: 'flow-mainnet',
  999: 'hyperliquid-mainnet',
  1088: 'metis-mainnet',
  1101: 'polygonzkevm-mainnet',
  1329: 'sei-mainnet',
  1514: 'story-mainnet',
  1868: 'soneium-mainnet',
  2020: 'ronin-mainnet',
  2741: 'abstract-mainnet',
  5000: 'mantle-mainnet',
  5330: 'superseed-mainnet',
  7000: 'zetachain-mainnet',
  8453: 'base-mainnet',
  33139: 'apechain-mainnet',
  34443: 'mode-mainnet',
  42161: 'arb-mainnet',
  42220: 'celo-mainnet',
  43114: 'avax-mainnet',
  57073: 'ink-mainnet',
  59144: 'linea-mainnet',
  80094: 'berachain-mainnet',
  81457: 'blast-mainnet',
  98866: 'plume-mainnet',
  534352: 'scroll-mainnet',
  7777777: 'zora-mainnet',
  // Testnets, for a laptop pointed at Sepolia.
  11155111: 'eth-sepolia',
  84532: 'base-sepolia',
  421614: 'arb-sepolia',
  11155420: 'opt-sepolia',
  80002: 'polygon-amoy',
}

/**
 * Where to read this chain.
 *
 * With a provider template — one key in config — every chain the provider
 * serves goes through the same paid endpoint, which is what rate limits and
 * reliability need. `{chainId}` is substituted with the EVM id, for providers
 * that route by number; `{network}` with Alchemy's name, for the one that
 * routes by subdomain. A chain the template cannot name, and any chain with
 * no template at all, reads through viem's public RPC. Never a hand-maintained
 * list of URLs.
 */
export function rpcUrlFor(chain: ChainId | string, template?: string): string {
  const info = requireChain(chain)
  if (template) {
    const network = ALCHEMY_NETWORK[info.evmId]
    if (!template.includes('{network}')) return template.replaceAll('{chainId}', String(info.evmId))
    if (network) return template.replaceAll('{network}', network).replaceAll('{chainId}', String(info.evmId))
  }
  const url = info.publicRpcUrls[0]
  if (!url) throw new CaipError(`chain ${info.id} (${info.name}) has no public RPC and the template cannot name it`)
  return url
}

/** Whether a template would route this chain through the provider, or fall back. */
export function providerServes(chain: ChainId | string, template: string): boolean {
  const info = requireChain(chain)
  return template.includes('{network}') ? info.evmId in ALCHEMY_NETWORK : true
}

export function explorerTxUrl(chain: ChainId | string, txHash: string): string | null {
  const base = findChain(chain)?.explorerUrl
  return base ? `${base}/tx/${txHash}` : null
}

export function explorerAddressUrl(chain: ChainId | string, address: string): string | null {
  const base = findChain(chain)?.explorerUrl
  return base ? `${base}/address/${address}` : null
}

/**
 * The chain's own currency as CAIP-19, for any chain a transfer could run on.
 *
 * The SLIP-44 table in caip.ts is authoritative where it has an entry. Beyond
 * it, a chain viem says spends ETH is a rollup or fork spending ETH, and ETH
 * is coin type 60 everywhere. A chain spending anything else needs its coin
 * type looked up and added to the table — guessing would name the wrong
 * currency — so it comes back null, and the caller says so.
 */
export function nativeAssetIdOf(chain: ChainId | string): string | null {
  try {
    return nativeAssetOf(chain)
  } catch {
    const info = findChain(chain)
    if (info?.nativeCurrency.symbol === 'ETH') return `${info.id}/slip44:60`
    return null
  }
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
