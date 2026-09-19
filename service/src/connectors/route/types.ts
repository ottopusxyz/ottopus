import type { Call } from '../../core/index.js'

/**
 * The route connector: one interface for swaps and bridges.
 *
 * Two intents, one connector, on purpose. A swap and a bridge are different
 * things to review — a bridge is two chains, a wait, and a second place your
 * money can be stuck — so they stay separate intents with separate rules.
 * But to a router they are the same question asked twice: what calls turn
 * this much of asset A into asset B, and the only difference is whether the
 * two assets are on the same chain. Splitting the connector would mean two
 * adapters per vendor, each mapping the same fields.
 *
 * Nothing above this folder names a provider. The concrete implementation is
 * chosen in config and can be replaced without touching the tool, the plan
 * format, the verify policy or the review page — which matters because the
 * provider is expected to change: 1inch is the likely next one and should be
 * droppable in behind this same interface.
 *
 * The hard requirement on any implementation is **calldata, not prices**. A
 * quote that cannot be turned into `to`/`value`/`data` is not a route: the
 * product's whole output is an unsigned transaction a person signs in their
 * own wallet, and Ottopus does not assemble router calldata itself.
 */

export interface RouteRequest {
  /** CAIP-19 asset going in. */
  fromAsset: string
  /** CAIP-19 asset coming out. Same chain means a swap, a different one a bridge. */
  toAsset: string
  /** Exactly one of these is fixed; the router decides the other. */
  amountIn?: string | undefined
  amountOut?: string | undefined
  /** CAIP-10 of the account that will sign. */
  fromAccount: string
  /**
   * Where the output should land. Omitted means the same address on the
   * destination chain, which is what a bridge to yourself wants. Never
   * defaulted silently to something else: sending someone else's swap output
   * to their own address is a different intent.
   */
  toAccount?: string | undefined
  /** Tolerance in basis points. The connector's default when omitted. */
  slippageBps?: number | undefined
}

/** What the route wants approved before it can run. Exact amounts only. */
export interface RouteApproval {
  /** CAIP-10 of the contract that will move the tokens. */
  spender: string
  /** CAIP-19 of the token being approved. */
  asset: string
  /** Base units. Never "unlimited" — the policy blocks that, and so does this type. */
  amount: string
}

export interface RouteQuote {
  /** Who routed it. Recorded on the plan and shown; never the simulator. */
  provider: string
  /**
   * The calls, in execution order. An approval first when one is needed,
   * then the router call. Both go in one plan so the person sees the whole
   * shape of what they are signing.
   */
  calls: Call[]
  /** What the router expects to come out, in the destination asset's base units. */
  expectedOut: string
  /** The floor it commits to after slippage. What the review page promises. */
  minOut: string
  /** Null when the input is the chain's own currency and no allowance is needed. */
  approval: RouteApproval | null
  /** Everything the route costs beyond gas, in USD, when the provider says. */
  feesUsd: string | null
  /** When the quote goes stale. Drives the plan's own expiry. */
  expiresAt: string
  /** The route in words, one per hop: "Swap on Aerodrome", "Bridge with Across". */
  steps: string[]
  /** The provider's own body, for the audit row. Never rendered, never trusted. */
  raw: unknown
}

export type RouteErrorCode =
  /** The pair or the chain pair is not something this provider routes. */
  | 'unsupported'
  /** It routes them, but found nothing for this amount right now. */
  | 'no_route'
  /** The provider could not be reached, or answered with something unusable. */
  | 'provider_failed'

export class RouteError extends Error {
  constructor(
    readonly code: RouteErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'RouteError'
  }
}

export interface RouteConnector {
  readonly name: string
  /**
   * Whether this provider routes between these two chains at all. Equal
   * chains is a swap; different ones a bridge. A provider that does only
   * same-chain swaps answers false for every pair that differs, and the
   * caller says so in a sentence rather than trying and failing.
   */
  serves(fromChain: string, toChain: string): boolean
  route(request: RouteRequest): Promise<RouteQuote>
}
