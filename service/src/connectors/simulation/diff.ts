import { ethAddress } from 'viem'
import {
  type AssetDelta,
  accountOn,
  assetDeltaSchema,
  canonicalize,
  findChain,
  nativeAssetIdOf,
  parseChainId,
  sha256Hex,
} from '../../core/index.js'

/**
 * Balance changes, as CAIP-19 rows the plan format can carry.
 *
 * The simulator answers in bare addresses — a token contract, or a sentinel
 * for the chain's own currency — and everything above this line speaks CAIP.
 * Translating here rather than at the call site keeps the vendor's shape from
 * leaking into the plan.
 *
 * The native row's words come from the chain registry, never from the
 * simulator. viem labels every native balance "ETH" with 18 decimals, which
 * is right on the rollups and wrong on BNB Chain, Polygon, Gnosis, Avalanche
 * and Celo — and a review page that says a person is sending ETH when they
 * are sending BNB is the exact failure the plan format exists to prevent.
 */

/** What a simulator reports before the ids are resolved. */
export interface RawAssetChange {
  token: { address: string; symbol?: string | undefined; decimals?: number | undefined }
  value: { pre: bigint; post: bigint; diff: bigint }
}

const isNativeSentinel = (address: string) =>
  address.toLowerCase() === ethAddress.toLowerCase() ||
  address.toLowerCase() === '0x0000000000000000000000000000000000000000'

/**
 * One row per asset that moved. A zero diff is dropped: an approval read and
 * re-read leaves the balance where it was, and a row saying nothing happened
 * is noise on a page whose whole job is to say what happens.
 */
export function deltasFrom(changes: readonly RawAssetChange[], chainId: string): AssetDelta[] {
  const chain = parseChainId(chainId)
  const info = findChain(chain)
  const nativeId = nativeAssetIdOf(chain)
  const rows: AssetDelta[] = []
  for (const change of changes) {
    if (change.value.diff === 0n) continue
    const native = isNativeSentinel(change.token.address)
    // A chain whose native currency Ottopus cannot name has no CAIP-19 id for
    // it, and a guessed id would name the wrong currency.
    if (native && !nativeId) continue
    const assetId = native
      ? nativeId!
      : `${chain.namespace}:${chain.reference}/erc20:${change.token.address.toLowerCase()}`
    const symbol = native ? (info?.nativeCurrency.symbol ?? null) : (change.token.symbol ?? null)
    const decimals = native ? (info?.nativeCurrency.decimals ?? null) : (change.token.decimals ?? null)
    rows.push(
      assetDeltaSchema.parse({
        assetId,
        symbol,
        decimals: decimals ?? null,
        diff: change.value.diff.toString(),
        pre: change.value.pre.toString(),
        post: change.value.post.toString(),
      }),
    )
  }
  // Biggest movement first, outgoing before incoming at equal size: what left
  // is what the person is deciding about. Ties break on the id so two runs
  // that found the same thing produce the same list — the result hash covers
  // this array, and an arbitrary order would make an identical simulation
  // hash differently.
  return rows.sort((a, b) => {
    const mag = abs(BigInt(b.diff)) - abs(BigInt(a.diff))
    if (mag !== 0n) return mag > 0n ? 1 : -1
    const da = BigInt(a.diff)
    const db = BigInt(b.diff)
    if (da !== db) return da < db ? -1 : 1
    return a.assetId < b.assetId ? -1 : a.assetId > b.assetId ? 1 : 0
  })
}

const abs = (n: bigint) => (n < 0n ? -n : n)

/** True when a contract at this address moved, by CAIP-19 id. */
export function contractAssetId(chainId: string, address: string): string {
  const chain = parseChainId(chainId)
  return `${chain.namespace}:${chain.reference}/erc20:${accountOn(chain, address).split(':')[2]}`
}

/**
 * A digest over what the run concluded, so a stored simulation can be proved
 * to be the one that was shown. Over the conclusions only — not the vendor's
 * raw body, which carries timing and request ids that differ between two runs
 * that found exactly the same thing.
 */
export interface Conclusions {
  chainId: string
  blockNumber: string
  success: boolean
  gasUsed: string
  assetChanges: readonly AssetDelta[]
  revertReason?: string | undefined
  failedCall?: number | undefined
}

export function resultHashOf(run: Conclusions): string {
  return sha256Hex(
    canonicalize({
      chainId: run.chainId,
      blockNumber: run.blockNumber,
      success: run.success,
      gasUsed: run.gasUsed,
      assetChanges: run.assetChanges,
      ...(run.revertReason ? { revertReason: run.revertReason } : {}),
      ...(run.failedCall ? { failedCall: run.failedCall } : {}),
    }),
  )
}
