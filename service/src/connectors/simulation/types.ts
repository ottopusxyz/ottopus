import type { AssetDelta, Call } from '../../core/index.js'

/**
 * The simulation adapter.
 *
 * One interface, two layers behind it, because the providers have to stay
 * replaceable: invariant 4 says the simulator must not be whoever built the
 * route, and a swap route provider chosen later must not be able to drag the
 * simulator along with it. Nothing outside this folder names a vendor.
 *
 * Layer 1 is deterministic and provider-independent — `eth_simulateV1`
 * through whatever RPC the chain registry gives, degrading to `eth_call` plus
 * `eth_estimateGas` on a node that lacks it. Layer 2 is a trace vendor for
 * internal calls and richer revert reasons, and slots in as a second
 * `Simulator` the composite prefers when it serves the chain.
 */

export interface SimulationRequest {
  chainId: string
  /** CAIP-10 of the account that will sign. `msg.sender` for every call. */
  account: string
  /** In order. A batch is simulated as a batch, since that is how it executes. */
  calls: readonly Call[]
}

export interface SimulationRun {
  /** Who ran it. Recorded, shown, and never the route provider. */
  provider: string
  chainId: string
  /** The block it was pinned to. A simulation without one cannot be reproduced. */
  blockNumber: string
  success: boolean
  /** Gas units over the whole batch. */
  gasUsed: string
  /** Every balance the run moved, for the account that signs. Empty is "not observed". */
  assetChanges: AssetDelta[]
  /** Whether the balances were traced at all, as opposed to traced and found empty. */
  tracedAssets: boolean
  revertReason?: string
  /** Which call reverted, 1-based. */
  failedCall?: number
  ranAt: string
  /** The provider's own answer, for the audit row. Never rendered. */
  raw: unknown
}

export interface Simulator {
  /** Recorded on the run and shown on the review page. */
  readonly name: string
  /** Whether this simulator can speak for the chain at all. */
  serves(chainId: string): boolean
  simulate(request: SimulationRequest): Promise<SimulationRun>
}

/**
 * No simulator could speak for this chain, or every one of them failed.
 *
 * Distinct from a simulation that ran and said no: that is a `SimulationRun`
 * with `success: false`, which blocks the plan. This is the absence of
 * evidence, which must never read as evidence of a problem — a chain nobody
 * simulates still gets a reviewable plan, with the page saying so.
 */
export class SimulationUnavailableError extends Error {
  constructor(
    readonly chainId: string,
    message: string,
  ) {
    super(message)
    this.name = 'SimulationUnavailableError'
  }
}
