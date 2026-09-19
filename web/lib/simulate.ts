import { type Hex, type Transport, createPublicClient, custom, ethAddress, http, zeroAddress } from 'viem'
import { simulateCalls } from 'viem/actions'
import type { AssetDelta, Plan, Simulation } from './api'
import { rawChain } from './chains'
import { addressOf } from './format'

/**
 * The review page simulates the plan itself, in the browser, at the block the
 * person is reading at.
 *
 * The service simulates once when the plan is built, and that run is the
 * policy gate: a plan the chain refused never gets a review link. But by the
 * time somebody opens the link the state has moved, and a diff computed
 * minutes ago is a claim about the past. This runs against the chain now, so
 * what the page shows is what would happen if they signed now.
 *
 * It needs no key. `eth_simulateV1` is a standard method and every public RPC
 * for the chains that matter answers it, with permissive CORS — measured
 * across Ethereum, Base, Arbitrum, Optimism, Polygon and BNB Chain. So the
 * browser talks to the chain directly and the service's provider credentials
 * stay where they belong.
 *
 * What this is not: verification. The page does not decode, hash or check
 * anything, and a browser run can never make a blocked plan signable — the
 * status the service wrote is the authority. A fresh run can only take
 * signing away, never grant it, which is the safe direction for evidence
 * that arrived after the plan was bound.
 */

/** Where the browser sent its simulation. A wallet's own node, or the chain's public one. */
export type SimulationVia = 'public' | 'wallet'

export interface BrowserSimulation extends Simulation {
  via: SimulationVia
}

export class SimulationFailed extends Error {
  constructor(
    readonly chainId: string,
    /** Kept for the console. Never rendered: it can carry a request URL. */
    readonly reason?: unknown,
  ) {
    super(`could not simulate on ${chainId}`)
    this.name = 'SimulationFailed'
  }
}

/** An EIP-1193 provider, as Privy hands it over. */
export interface Eip1193 {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>
}

/** What the page knows about the chain's own currency. From the service, never guessed here. */
export interface NativeWords {
  nativeAssetId: string | null
  nativeSymbol: string
  nativeDecimals: number
}

export interface SimulateOptions {
  /** The connected wallet's provider. Tried first when present: its node, no CORS, no third party. */
  provider?: Eip1193 | null
  /** For tests. */
  now?: () => Date
}

const isNative = (address: string) =>
  address.toLowerCase() === ethAddress.toLowerCase() || address.toLowerCase() === zeroAddress

/**
 * Simulate a plan's calls as a batch, because that is how they execute.
 *
 * Tries the connected wallet's node first — it is the person's own provider,
 * and it means the page depends on nothing new — then the chain's public RPC.
 * A wallet whose node has never heard of `eth_simulateV1` is common, so the
 * fallback is the expected path rather than an error case.
 */
export async function simulatePlan(
  plan: Plan,
  chainId: string,
  native: NativeWords,
  options: SimulateOptions = {},
): Promise<BrowserSimulation> {
  if (plan.outcome.type !== 'calls' || plan.outcome.calls.length === 0) {
    throw new SimulationFailed(chainId)
  }
  const chain = rawChain(chainId)
  if (!chain) throw new SimulationFailed(chainId)
  const account = addressOf(plan.resolution.account.caip10) as Hex
  const calls = plan.outcome.calls.map((call) => ({
    to: addressOf(call.to) as Hex,
    value: BigInt(call.value),
    ...(call.data && call.data !== '0x' ? { data: call.data as Hex } : {}),
  }))

  /**
   * Every node worth asking, in order of preference.
   *
   * More than one public endpoint because a traced simulation is about six
   * requests, and free endpoints rate-limit: measured a clean run and then a
   * refusal from the same host seconds later under load. One 429 should cost
   * the reader a slower answer, not the feature.
   */
  const attempts: { via: SimulationVia; transport: Transport }[] = [
    ...(options.provider ? [{ via: 'wallet' as const, transport: custom(options.provider as never) }] : []),
    ...chain.rpcUrls.default.http.map((url) => ({
      via: 'public' as const,
      transport: http(url, { timeout: 15_000 }),
    })),
  ]

  let last: unknown
  for (const attempt of attempts) {
    try {
      const client = createPublicClient({ chain, transport: attempt.transport })
      const result = await simulateCalls(client, { account, calls, traceAssetChanges: true })
      return read(result, { chainId, via: attempt.via, native, now: options.now?.() ?? new Date() })
    } catch (err) {
      last = err
    }
  }
  throw last instanceof SimulationFailed ? last : new SimulationFailed(chainId, last)
}

/**
 * What a simulation answer looks like, structurally.
 *
 * Declared here rather than borrowed from viem's generic return type, which
 * is parameterised by the exact tuple of calls passed in. Reading the answer
 * has nothing to do with how many calls there were, and a local shape makes
 * the mapping testable without a client.
 */
export interface SimulationAnswer {
  block: { number?: bigint | null }
  results: readonly { status: 'success' | 'failure'; gasUsed?: bigint | undefined; error?: unknown }[]
  assetChanges: readonly RawChange[]
}

export interface RawChange {
  token: { address: string; symbol?: string | undefined; decimals?: number | undefined }
  value: { pre: bigint; post: bigint; diff: bigint }
}

export function read(
  result: SimulationAnswer,
  context: { chainId: string; via: SimulationVia; native: NativeWords; now: Date },
): BrowserSimulation {
  const failedIndex = result.results.findIndex((r) => r.status === 'failure')
  const failed = failedIndex >= 0 ? result.results[failedIndex] : undefined
  const gasUsed = result.results.reduce((total, r) => total + (r.gasUsed ?? 0n), 0n)
  return {
    provider: context.via === 'wallet' ? 'eth_simulateV1 · your wallet’s node' : 'eth_simulateV1 · public RPC',
    via: context.via,
    chainId: context.chainId,
    blockNumber: (result.block.number ?? 0n).toString(),
    success: failedIndex < 0,
    assetChanges: deltas(result.assetChanges, context.chainId, context.native),
    gasUsed: gasUsed.toString(),
    // The dollar figure belongs to the plan: it was priced when the plan was
    // built and hashed with it. The browser has no price feed and must not
    // invent one.
    gasUsd: 'unknown',
    ...(failed?.error ? { revertReason: reasonOf(failed.error) } : {}),
    ...(failedIndex >= 0 ? { failedCall: failedIndex + 1 } : {}),
    resultHash: '',
    ranAt: context.now.toISOString(),
  }
}

/**
 * Balance changes as CAIP-19 rows, matching what the service produces so the
 * page renders both the same way.
 *
 * The native row's id and symbol come from the service's chain visual. viem
 * calls every native balance ETH with 18 decimals, which is the wrong
 * currency on BNB Chain, Polygon, Gnosis, Avalanche and Celo, and the
 * SLIP-44 table that knows better lives in the service.
 */
function deltas(changes: readonly RawChange[], chainId: string, native: NativeWords): AssetDelta[] {
  const rows: AssetDelta[] = []
  for (const change of changes) {
    if (change.value.diff === 0n) continue
    const isNativeRow = isNative(change.token.address)
    if (isNativeRow && !native.nativeAssetId) continue
    rows.push({
      assetId: isNativeRow ? native.nativeAssetId! : `${chainId}/erc20:${change.token.address.toLowerCase()}`,
      symbol: isNativeRow ? native.nativeSymbol : (change.token.symbol ?? null),
      decimals: isNativeRow ? native.nativeDecimals : (change.token.decimals ?? null),
      diff: change.value.diff.toString(),
      pre: change.value.pre.toString(),
      post: change.value.post.toString(),
    })
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

const abs = (n: bigint) => (n < 0n ? -n : n)

/**
 * Why it reverted, in one line, with no request in it. viem's full message
 * prints the RPC URL; these are keyless public endpoints, but a page that
 * prints URLs at people is one config change away from printing a key.
 */
export function reasonOf(err: unknown, limit = 200): string {
  const e = err as { shortMessage?: string; details?: string; name?: string }
  const lines = (e?.shortMessage ?? e?.details ?? e?.name ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
  const said = lines.find((line) => !line.endsWith(':') && !/^the contract function/i.test(line))
  const clean = said ?? (lines.length > 0 ? 'the call reverted without giving a reason' : 'the call reverted')
  if (clean.includes('://')) return 'the call reverted'
  return clean.length > limit ? `${clean.slice(0, limit - 1)}…` : clean
}
