import { z } from 'zod'

/**
 * CAIP identifiers — the only way chains, accounts and assets are named.
 *
 * A bare "0xabc" or chainId 8453 is ambiguous the moment a second chain exists,
 * and this product is multi-chain from the first plan. Every boundary — MCP tool
 * inputs, plan payloads, the database — uses these instead.
 *
 *   CAIP-2  chain    eip155:8453
 *   CAIP-10 account  eip155:8453:0xd8da...
 *   CAIP-19 asset    eip155:8453/erc20:0x833589...   native: eip155:8453/slip44:60
 *
 * Grammar follows the specs: namespace [-a-z0-9]{3,8}, reference
 * [-_a-zA-Z0-9]{1,32}, address and asset reference [-.%a-zA-Z0-9]{1,128}.
 */

const NAMESPACE = '[-a-z0-9]{3,8}'
const REFERENCE = '[-_a-zA-Z0-9]{1,32}'
const ACCOUNT_ADDRESS = '[-.%a-zA-Z0-9]{1,128}'
const ASSET_NAMESPACE = '[-a-z0-9]{3,8}'
const ASSET_REFERENCE = '[-.%a-zA-Z0-9]{1,128}'
const TOKEN_ID = '[-.%a-zA-Z0-9]{1,78}'

export const CHAIN_ID_RE = new RegExp(`^(${NAMESPACE}):(${REFERENCE})$`)
export const ACCOUNT_ID_RE = new RegExp(`^(${NAMESPACE}):(${REFERENCE}):(${ACCOUNT_ADDRESS})$`)
export const ASSET_TYPE_RE = new RegExp(
  `^(${NAMESPACE}):(${REFERENCE})/(${ASSET_NAMESPACE}):(${ASSET_REFERENCE})(?:/(${TOKEN_ID}))?$`,
)

export interface ChainId {
  namespace: string
  reference: string
}

export interface AccountId extends ChainId {
  address: string
}

export interface AssetId extends ChainId {
  assetNamespace: string
  assetReference: string
  tokenId?: string
}

export class CaipError extends Error {}

/** 20 bytes, hex. Anything else cannot be an EVM account or contract. */
export const EVM_ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/

/**
 * SLIP-44 coin type per EVM chain. Not every EIP-155 chain is ETH — BNB Smart
 * Chain is 714 — so this is a lookup rather than an assumption, and an unknown
 * chain throws instead of silently naming the wrong currency.
 */
const EVM_NATIVE_COIN_TYPE: Readonly<Record<string, number>> = {
  '1': 60, // Ethereum, ETH
  '10': 60, // Optimism, ETH
  '8453': 60, // Base, ETH
  '42161': 60, // Arbitrum One, ETH
  '56': 714, // BNB Smart Chain, BNB
  '137': 966, // Polygon, POL
}

/** Asset namespaces whose reference is a contract address. */
const CONTRACT_ASSET_NAMESPACES = new Set(['erc20', 'erc721', 'erc1155'])

/**
 * Generic CAIP validity is not enough to execute against. "eip155:base" and
 * "eip155:1:0xabc" are well-formed CAIP and still cannot produce a transaction,
 * so eip155 gets checked properly rather than waved through.
 */
function assertEvmChainReference(reference: string): void {
  if (!/^[1-9][0-9]*$/.test(reference)) {
    throw new CaipError(`EVM chain reference must be a positive decimal: ${reference}`)
  }
  if (!Number.isSafeInteger(Number(reference))) {
    throw new CaipError(`EVM chain reference is out of safe integer range: ${reference}`)
  }
}

function assertEvmAddress(address: string, what: string): void {
  if (!EVM_ADDRESS_RE.test(address)) {
    throw new CaipError(`${what} must be a 20-byte hex address: ${address}`)
  }
}

/**
 * EVM addresses are compared, indexed and stored lowercase — the database has a
 * check constraint saying so. Checksum casing is a display concern and must
 * never reach a lookup key, or the same wallet linked twice looks like two.
 */
function normaliseAddress(namespace: string, address: string): string {
  return namespace === 'eip155' ? address.toLowerCase() : address
}

export function parseChainId(input: string): ChainId {
  const m = CHAIN_ID_RE.exec(input)
  if (!m) throw new CaipError(`not a CAIP-2 chain id: ${input}`)
  const chain = { namespace: m[1]!, reference: m[2]! }
  if (chain.namespace === 'eip155') assertEvmChainReference(chain.reference)
  return chain
}

/**
 * The exported formatters validate, so a constructed identifier can never be
 * one the parsers would reject. Building an id and parsing it back must agree,
 * or callers can smuggle malformed values in through the back door.
 */
export function formatChainId(chain: ChainId): string {
  if (chain.namespace === 'eip155') assertEvmChainReference(chain.reference)
  return `${chain.namespace}:${chain.reference}`
}

export function parseAccountId(input: string): AccountId {
  const m = ACCOUNT_ID_RE.exec(input)
  if (!m) throw new CaipError(`not a CAIP-10 account id: ${input}`)
  const namespace = m[1]!
  const reference = m[2]!
  const address = m[3]!
  if (namespace === 'eip155') {
    assertEvmChainReference(reference)
    assertEvmAddress(address, 'EVM account address')
  }
  return { namespace, reference, address: normaliseAddress(namespace, address) }
}

export function formatAccountId(account: AccountId): string {
  if (account.namespace === 'eip155') {
    assertEvmChainReference(account.reference)
    assertEvmAddress(account.address, 'EVM account address')
  }
  return `${account.namespace}:${account.reference}:${normaliseAddress(account.namespace, account.address)}`
}

export function parseAssetId(input: string): AssetId {
  const m = ASSET_TYPE_RE.exec(input)
  if (!m) throw new CaipError(`not a CAIP-19 asset id: ${input}`)
  const namespace = m[1]!
  const assetNamespace = m[3]!
  const isEvmContract = namespace === 'eip155' && CONTRACT_ASSET_NAMESPACES.has(assetNamespace)
  if (namespace === 'eip155') assertEvmChainReference(m[2]!)
  if (isEvmContract) assertEvmAddress(m[4]!, `${assetNamespace} contract address`)
  if (namespace === 'eip155' && assetNamespace === 'slip44') {
    // eip155:56/slip44:60 is well-formed and names ETH's coin type on BNB
    // Chain. isNativeAsset would call it native, and it would be the wrong
    // currency. Only enforced for chains we know; an unknown chain has no
    // expected coin type to check against.
    const expected = EVM_NATIVE_COIN_TYPE[m[2]!]
    if (expected !== undefined && m[4] !== String(expected)) {
      throw new CaipError(
        `native asset for eip155:${m[2]} is slip44:${expected}, not slip44:${m[4]}`,
      )
    }
  }
  const asset: AssetId = {
    namespace,
    reference: m[2]!,
    assetNamespace,
    assetReference: isEvmContract ? m[4]!.toLowerCase() : m[4]!,
  }
  if (m[5] !== undefined) asset.tokenId = m[5]
  return asset
}

export function formatAssetId(asset: AssetId): string {
  const base = `${asset.namespace}:${asset.reference}/${asset.assetNamespace}:${asset.assetReference}`
  const full = asset.tokenId === undefined ? base : `${base}/${asset.tokenId}`
  // Round-trip through the parser so construction and parsing cannot disagree.
  if (asset.namespace === 'eip155') parseAssetId(full)
  return full
}

/** An account on a chain, without repeating the chain. */
export function accountOn(chain: ChainId, address: string): string {
  return formatAccountId({ ...chain, address })
}

/** The chain an account or asset belongs to. */
export function chainOf(id: AccountId | AssetId): ChainId {
  return { namespace: id.namespace, reference: id.reference }
}

/**
 * EVM chain id as a number, for viem and wallet RPC. Throws on a non-EVM chain
 * rather than returning NaN, which would silently target the wrong network.
 */
export function toEvmChainId(chain: ChainId | string): number {
  const parsed = typeof chain === 'string' ? parseChainId(chain) : chain
  if (parsed.namespace !== 'eip155') {
    throw new CaipError(`not an EVM chain: ${formatChainId(parsed)}`)
  }
  const id = Number(parsed.reference)
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new CaipError(`invalid EVM chain reference: ${parsed.reference}`)
  }
  return id
}

export function fromEvmChainId(chainId: number): ChainId {
  if (!Number.isSafeInteger(chainId) || chainId <= 0) {
    throw new CaipError(`invalid EVM chain id: ${chainId}`)
  }
  return { namespace: 'eip155', reference: String(chainId) }
}

/** The chain's own currency, e.g. ETH on Base is eip155:8453/slip44:60. */
export function nativeAssetOf(chain: ChainId | string): string {
  const parsed = typeof chain === 'string' ? parseChainId(chain) : chain
  if (parsed.namespace !== 'eip155') {
    throw new CaipError(`no known native asset for ${formatChainId(parsed)}`)
  }
  const coinType = EVM_NATIVE_COIN_TYPE[parsed.reference]
  if (coinType === undefined) {
    // Assuming 60 would name ETH on a chain whose currency is not ETH.
    throw new CaipError(`unknown native currency for ${formatChainId(parsed)}; add it to EVM_NATIVE_COIN_TYPE`)
  }
  return `${formatChainId(parsed)}/slip44:${coinType}`
}

/** True when two CAIP identifiers name the same chain. */
export function sameChain(a: ChainId | AccountId | AssetId, b: ChainId | AccountId | AssetId): boolean {
  return a.namespace === b.namespace && a.reference === b.reference
}

export function isNativeAsset(asset: AssetId | string): boolean {
  const parsed = typeof asset === 'string' ? parseAssetId(asset) : asset
  return parsed.assetNamespace === 'slip44'
}

/**
 * Zod schemas. These parse to the normalised string form, so anything that
 * survives validation is already lowercased where it should be — callers cannot
 * forget.
 */
export const chainIdSchema = z
  .string()
  .regex(CHAIN_ID_RE, 'expected a CAIP-2 chain id, e.g. eip155:8453')
  .transform((s) => formatChainId(parseChainId(s)))

export const accountIdSchema = z
  .string()
  .regex(ACCOUNT_ID_RE, 'expected a CAIP-10 account id, e.g. eip155:8453:0xabc…')
  .transform((s) => formatAccountId(parseAccountId(s)))

export const assetIdSchema = z
  .string()
  .regex(ASSET_TYPE_RE, 'expected a CAIP-19 asset id, e.g. eip155:8453/erc20:0xabc…')
  .transform((s) => formatAssetId(parseAssetId(s)))
