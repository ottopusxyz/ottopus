import {
  type AssetDelta,
  type Plan,
  chainName,
  findChain,
  nativeAssetIdOf,
  parseAccountId,
  parseChainId,
  toEvmChainId,
} from '../../core/index.js'
import { type BinanceClient, BinanceError } from '../binance/index.js'
import type { TokenRegistry } from '../tokens/index.js'

/**
 * A second opinion on a plan, from Binance's simulator, for the review page
 * and nowhere else.
 *
 * Advice, not evidence. It is not a `Simulator`: it never enters the
 * composite, verify never reads it, the hash never covers it, and plan status
 * never depends on it. The page shows it beside the browser-side simulation
 * under its own label, and a disagreement between the two is something for
 * the person to read, not something for the service to resolve. Nothing here
 * is stored.
 *
 * The vendor simulates one transaction per request, alone, against the chain
 * head — there is no batch and no block pinning. So a plan's calls go one
 * after another, each as if it were the only one: a swap simulated without
 * its approve fails on the allowance it does not yet have, and that is what
 * the page will say. The reason names the call, so "call 2 of 2: transfer
 * amount exceeds allowance" reads as what it is. Balance changes are summed
 * only when every call passed; a partial sum would describe a plan nobody
 * will sign.
 *
 * The vendor reports the sender's balances only, as a signed change with no
 * before and after, so the rows here are the plan's `AssetDelta` without
 * `pre` and `post`. Gas is not among them, and neither the sender's balance
 * nor the gas is checked: a wallet with nothing in it sending one wei comes
 * back SUCCESS. The browser simulation is the one that catches that.
 */

export const BINANCE_SIMULATION_PROVIDER = 'binance'
const SIMULATE_PATH = '/api/v1/dex/pre-transaction/simulate'

/** The vendor's code for a chain its simulator does not serve. */
const CODE_CHAIN_UNSUPPORTED = 40411

/** The vendor names the chain's own currency by this address. */
const NATIVE_SENTINEL = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'

export type BinanceBalanceChange = Omit<AssetDelta, 'pre' | 'post'>

/** Kept in the vendor's words: the token, who may spend it, and the allowance before and after. */
export interface BinanceAllowanceChange {
  tokenAddress: string
  spender: string
  preAmount: string
  postAmount: string
}

export interface BinanceSimulation {
  provider: typeof BINANCE_SIMULATION_PROVIDER
  /** `unavailable` is the absence of an answer, never a verdict on the plan. */
  status: 'SUCCESS' | 'FAILED' | 'unavailable'
  /** The vendor's reason on FAILED, in its own words; a sentence of ours on `unavailable`. */
  failReason: string | null
  /** Which call the vendor refused, 1-based, when one was. */
  failedCall: number | null
  balanceChanges: BinanceBalanceChange[]
  allowanceChanges: BinanceAllowanceChange[]
  /** When it ran. The vendor pins no block, so this is the only provenance there is. */
  ranAt: string
}

export type BinanceSimulate = (plan: Plan) => Promise<BinanceSimulation>

export interface BinanceSimulatorOptions {
  /** Null when no credential is configured; every answer is then `unavailable`. */
  client: BinanceClient | null
  /** Words for the rows. Null costs a symbol, never a row. */
  tokens?: TokenRegistry | null
  now?: () => Date
}

/** What the vendor answered live on 2026-09-26, trimmed to what is read. */
interface VendorBalanceChange {
  contractAddress?: string
  tokenType?: string
  /** Signed base units, decimal. */
  change?: string
  owner?: string
}

interface VendorAllowanceChange {
  tokenAddress?: string
  contractAddress?: string
  owner?: string
  spender?: string
  preAmount?: string
  postAmount?: string
}

interface VendorSimulation {
  status?: string
  failReason?: string
  balanceChanges?: VendorBalanceChange[]
  allowanceChanges?: VendorAllowanceChange[]
}

/** The shape of "no answer", for the route to use when nothing is wired at all. */
export function unavailableSimulation(reason: string, now: () => Date = () => new Date()): BinanceSimulation {
  return {
    provider: BINANCE_SIMULATION_PROVIDER,
    status: 'unavailable',
    failReason: reason,
    failedCall: null,
    balanceChanges: [],
    allowanceChanges: [],
    ranAt: now().toISOString(),
  }
}

export function binanceSimulator(options: BinanceSimulatorOptions): BinanceSimulate {
  const { client } = options
  const tokens = options.tokens ?? null
  const now = options.now ?? (() => new Date())

  return async (plan) => {
    try {
      return await simulate(plan)
    } catch (err) {
      // Never an error to the page. The vendor's words when it answered;
      // ours, without its URL or the key that went with it, when it did not.
      return unavailableSimulation(reasonOf(err), now)
    }
  }

  async function simulate(plan: Plan): Promise<BinanceSimulation> {
    if (!client) return unavailableSimulation('no Binance credential is configured', now)
    if (plan.outcome.type !== 'calls') return unavailableSimulation('only a plan of calls can be simulated', now)

    const signer = parseAccountId(plan.resolution.account.caip10)
    const chainId = `${signer.namespace}:${signer.reference}`
    if (signer.namespace !== 'eip155' || !findChain(chainId)) {
      return unavailableSimulation(`Binance does not simulate on ${chainName(chainId)}`, now)
    }
    const binanceChainId = String(toEvmChainId(parseChainId(chainId)))
    const calls = plan.outcome.calls
    const sums = new Map<string, bigint>()
    const allowances: BinanceAllowanceChange[] = []

    for (const [index, call] of calls.entries()) {
      const answer = await client.post<VendorSimulation>(SIMULATE_PATH, {
        binanceChainId,
        evmTx: { from: signer.address, to: parseAccountId(call.to).address, value: call.value, data: call.data },
      })
      if (answer?.status !== 'SUCCESS') {
        // The first refusal is the answer. Later calls would run against a
        // state this one never reached, and nothing they say would be shown.
        const reason = answer?.failReason?.trim() || 'the vendor gave no reason'
        return {
          provider: BINANCE_SIMULATION_PROVIDER,
          status: 'FAILED',
          failReason: calls.length > 1 ? `call ${index + 1} of ${calls.length}: ${reason}` : reason,
          failedCall: index + 1,
          balanceChanges: [],
          allowanceChanges: [],
          ranAt: now().toISOString(),
        }
      }
      for (const change of answer.balanceChanges ?? []) {
        // The vendor reports the sender's side only, but a row it ever
        // attributes to someone else is not a change to this wallet.
        if (change.owner && change.owner.toLowerCase() !== signer.address.toLowerCase()) continue
        const assetId = assetIdOf(chainId, change)
        const diff = bigintOf(change.change)
        if (!assetId || diff === null) continue
        sums.set(assetId, (sums.get(assetId) ?? 0n) + diff)
      }
      for (const change of answer.allowanceChanges ?? []) {
        const tokenAddress = change.tokenAddress ?? change.contractAddress
        if (!tokenAddress || !change.spender) continue
        allowances.push({
          tokenAddress: tokenAddress.toLowerCase(),
          spender: change.spender.toLowerCase(),
          preAmount: change.preAmount ?? '0',
          postAmount: change.postAmount ?? '0',
        })
      }
    }

    return {
      provider: BINANCE_SIMULATION_PROVIDER,
      status: 'SUCCESS',
      failReason: null,
      failedCall: null,
      balanceChanges: await rowsOf(chainId, sums),
      allowanceChanges: allowances,
      ranAt: now().toISOString(),
    }
  }

  /** One row per asset that moved, worded from the registry, biggest movement first. */
  async function rowsOf(chainId: string, sums: ReadonlyMap<string, bigint>): Promise<BinanceBalanceChange[]> {
    const info = findChain(chainId)
    const nativeId = nativeAssetIdOf(chainId)
    const rows: BinanceBalanceChange[] = []
    for (const [assetId, diff] of sums) {
      if (diff === 0n) continue
      if (assetId === nativeId) {
        rows.push({ assetId, symbol: info?.nativeCurrency.symbol ?? null, decimals: info?.nativeCurrency.decimals ?? null, diff: diff.toString() })
        continue
      }
      const known = await tokens?.byAssetId(assetId).catch(() => null)
      rows.push({ assetId, symbol: known?.symbol ?? null, decimals: known?.decimals ?? null, diff: diff.toString() })
    }
    return rows.sort((a, b) => {
      const mag = abs(BigInt(b.diff)) - abs(BigInt(a.diff))
      if (mag !== 0n) return mag > 0n ? 1 : -1
      const da = BigInt(a.diff)
      const db = BigInt(b.diff)
      if (da !== db) return da < db ? -1 : 1
      return a.assetId < b.assetId ? -1 : a.assetId > b.assetId ? 1 : 0
    })
  }
}

/** CAIP-19 for a vendor row, or null for a native currency Ottopus cannot name. */
function assetIdOf(chainId: string, change: VendorBalanceChange): string | null {
  const address = change.contractAddress?.toLowerCase()
  if (!address) return null
  if (change.tokenType?.toLowerCase() === 'native' || address === NATIVE_SENTINEL) return nativeAssetIdOf(chainId)
  return `${chainId}/erc20:${address}`
}

function bigintOf(value: string | undefined): bigint | null {
  if (value === undefined || !/^-?[0-9]+$/.test(value.trim())) return null
  return BigInt(value.trim())
}

const abs = (n: bigint) => (n < 0n ? -n : n)

/** Why there is no answer, in one sentence the page can show. */
function reasonOf(err: unknown): string {
  if (err instanceof BinanceError) {
    if (err.code === 'rejected' && err.vendorCode === CODE_CHAIN_UNSUPPORTED) return 'Binance does not simulate on this chain'
    if (err.code === 'not_configured') return 'Binance refused the API key'
    if (err.code === 'rate_limited') return 'Binance is rate limiting; try again shortly'
    if (err.code === 'unavailable') return `Binance could not be reached: ${firstLine(err.message)}`
    return `Binance refused: ${firstLine(err.message)}`
  }
  return 'the simulation could not run'
}

function firstLine(message: string): string {
  const clean = message.split('\n')[0]?.trim() ?? ''
  if (!clean || clean.includes('://')) return 'the vendor refused the request'
  return clean.length > 160 ? `${clean.slice(0, 159)}…` : clean
}
