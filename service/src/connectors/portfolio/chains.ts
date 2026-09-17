/**
 * Zerion names chains with slugs — `base`, `binance-smart-chain`. Everything
 * past the connector boundary uses CAIP-2, so the translation happens here and
 * nowhere else.
 *
 * The table is fetched from the provider rather than hardcoded: Zerion adds
 * chains, and a hardcoded map turns a new chain into a silently missing
 * balance. `external_id` is documented only as the "community used chain ID",
 * and Zerion writes it as hex on some chains and decimal on others, so both are
 * accepted.
 */

import { CaipError, formatChainId, fromEvmChainId } from '../../core/index.js'

export interface ChainEntry {
  /** Zerion's slug. */
  id: string
  name: string
  iconUrl?: string | null
  /** EIP-155 chain id, hex or decimal, however the provider wrote it. */
  externalId: string | null | undefined
}

/**
 * The EIP-155 number out of an `external_id`, or null when it is not one.
 *
 * Solana's entry has no numeric id at all, and a chain we cannot number is a
 * chain we cannot name in CAIP-2 — null, not a guess.
 */
export function evmChainIdOf(externalId: string | null | undefined): number | null {
  if (!externalId) return null
  const raw = externalId.trim()

  if (!/^0[xX][0-9a-fA-F]+$/.test(raw) && !/^[0-9]+$/.test(raw)) return null

  const n = Number(raw)
  if (!Number.isSafeInteger(n) || n <= 0) return null
  return n
}

/**
 * Both directions between a provider's chain slugs and CAIP-2.
 *
 * Built once per process from `/v1/chains/` and treated as immutable — a chain
 * list that changed underneath a request would put two chain ids on one
 * portfolio.
 */
export class ChainMap {
  private readonly toCaip = new Map<string, string>()
  private readonly toSlug = new Map<string, string>()
  private readonly icons = new Map<string, string>()
  private readonly names = new Map<string, string>()

  constructor(entries: readonly ChainEntry[]) {
    for (const entry of entries) {
      const chainId = evmChainIdOf(entry.externalId)
      if (chainId === null) continue

      let caip: string
      try {
        caip = formatChainId(fromEvmChainId(chainId))
      } catch (err) {
        // A chain id past the safe integer range is the provider's problem, not
        // a reason to fail the whole map.
        if (err instanceof CaipError) continue
        throw err
      }

      this.toCaip.set(entry.id, caip)
      this.toSlug.set(caip, entry.id)
      this.names.set(caip, entry.name)
      if (entry.iconUrl) this.icons.set(caip, entry.iconUrl)
    }
  }

  /** CAIP-2 for a provider slug, or null when the chain is not EVM. */
  caipOf(slug: string): string | null {
    return this.toCaip.get(slug) ?? null
  }

  /** The provider's slug for a CAIP-2 chain, for filter parameters. */
  slugOf(chainId: string): string | null {
    return this.toSlug.get(chainId) ?? null
  }

  /** Human name for a chain — "BNB Chain", not "binance-smart-chain". */
  nameOf(chainId: string): string | null {
    return this.names.get(chainId) ?? null
  }

  iconOf(chainId: string): string | null {
    return this.icons.get(chainId) ?? null
  }

  get size(): number {
    return this.toCaip.size
  }
}
