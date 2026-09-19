import type { Simulation } from '../../core/index.js'
import { simulationSchema } from '../../core/index.js'
import { resultHashOf } from './diff.js'
import type { SimulationRequest, SimulationRun, Simulator } from './types.js'
import { SimulationUnavailableError } from './types.js'

export { BASELINE_PROVIDER, LEGACY_PROVIDER, baselineSimulator, reasonOf, type BaselineOptions } from './baseline.js'
export { contractAssetId, deltasFrom, resultHashOf, type Conclusions, type RawAssetChange } from './diff.js'
export {
  SimulationUnavailableError,
  type SimulationRequest,
  type SimulationRun,
  type Simulator,
} from './types.js'

/**
 * The adapter: several simulators, one answer.
 *
 * Ordered by preference — a rich vendor first, the deterministic baseline
 * last — and each is asked only if it serves the chain. A simulator that
 * throws is passed over rather than fatal: the point of two layers is that
 * losing one costs detail, not the review.
 *
 * A run that traced no balances loses to one that did, even if the untraced
 * one came from a preferred vendor, because the asset diff is the thing the
 * page is actually for. Success and gas agree between them anyway.
 */
export function composite(simulators: readonly Simulator[]): Simulator {
  return {
    name: 'composite',
    serves: (chainId) => simulators.some((s) => s.serves(chainId)),
    async simulate(request) {
      const serving = simulators.filter((s) => s.serves(request.chainId))
      if (serving.length === 0) {
        throw new SimulationUnavailableError(request.chainId, `no simulator serves ${request.chainId}`)
      }
      const failures: string[] = []
      let thin: SimulationRun | null = null
      for (const simulator of serving) {
        try {
          const run = await simulator.simulate(request)
          if (run.tracedAssets || run.success === false) return run
          thin ??= run
        } catch (err) {
          failures.push(`${simulator.name}: ${err instanceof Error ? err.message : String(err)}`)
        }
      }
      if (thin) return thin
      throw new SimulationUnavailableError(
        request.chainId,
        `every simulator failed on ${request.chainId} — ${failures.join('; ')}`,
      )
    },
  }
}

/**
 * A run, priced and shaped for the plan.
 *
 * Gas is quoted in the chain's own currency times whatever price the caller
 * has to hand — the portfolio knows it, and a simulator has no business
 * knowing about dollars. No price means "unknown", which is the string the
 * review page already renders as "your wallet will show it": an invented
 * number would be worse than the honest absence.
 */
export interface Pricing {
  /** Wei per gas. The block's base fee is a floor, and a floor is what an estimate should be. */
  gasPriceWei?: string | null
  /** USD per whole unit of the chain's currency. */
  nativePriceUsd?: number | null
  nativeDecimals?: number | null
}

export function asSimulation(run: SimulationRun, pricing: Pricing = {}): Simulation {
  const { raw: _raw, tracedAssets: _traced, ...conclusions } = run
  const resultHash =
    (run.raw as { resultHash?: unknown } | null)?.resultHash ??
    resultHashOf({ ...conclusions, chainId: run.chainId })
  return simulationSchema.parse({
    provider: run.provider,
    chainId: run.chainId,
    blockNumber: run.blockNumber,
    success: run.success,
    assetChanges: run.assetChanges,
    // Carried, not dropped: an empty diff means two different things, and
    // the custom tier refuses a run that never looked.
    tracedAssets: run.tracedAssets,
    gasUsed: run.gasUsed,
    gasUsd: gasUsd(run.gasUsed, pricing),
    ...(run.revertReason ? { revertReason: run.revertReason } : {}),
    ...(run.failedCall ? { failedCall: run.failedCall } : {}),
    resultHash: String(resultHash),
    ranAt: run.ranAt,
  })
}

/** Two decimals, or "unknown" when any input is missing. Never a float in, never a float stored. */
export function gasUsd(gasUsed: string, { gasPriceWei, nativePriceUsd, nativeDecimals }: Pricing): string {
  if (!gasPriceWei || !nativePriceUsd || nativeDecimals === null || nativeDecimals === undefined) return 'unknown'
  try {
    const wei = BigInt(gasUsed) * BigInt(gasPriceWei)
    // Cents in integer arithmetic, so the string never depends on float width.
    const cents = (wei * BigInt(Math.round(nativePriceUsd * 100))) / 10n ** BigInt(nativeDecimals)
    if (cents <= 0n) return '0.01'
    return `${cents / 100n}.${String(cents % 100n).padStart(2, '0')}`
  } catch {
    return 'unknown'
  }
}

/** What the simulator was asked, kept beside the answer so a run can be reproduced. */
export type { SimulationRequest as SimulationInput }
