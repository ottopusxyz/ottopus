import { z } from 'zod'
import type { ChainId } from './caip.js'
import {
  accountIdSchema,
  assetIdSchema,
  chainIdSchema,
  chainOf,
  parseAccountId,
  parseAssetId,
  parseChainId,
  sameChain,
} from './caip.js'

/**
 * What the user asked for, as the agent expressed it.
 *
 * These are the MCP tool inputs and the stored intent — one definition, so a
 * tool cannot accept something the plan engine will not understand.
 *
 * The agent handles conversation; there is no natural-language parsing here.
 * Tools take typed arguments, which is what keeps a misread instruction a
 * validation error rather than a wrong transaction.
 */

/**
 * Base-unit integer as a decimal string. Never a number: 10^18 wei exceeds
 * Number.MAX_SAFE_INTEGER, and a float would silently lose precision on an
 * amount someone is about to sign.
 */
export const amountSchema = z
  .string()
  .regex(/^[0-9]+$/, 'expected an integer amount in base units, as a string')
  .refine((s) => s.length <= 78, 'amount is implausibly large')
  // A zero-value plan is either useless or provider-dependent, and it still
  // asks someone to sign something.
  .refine((s) => /[1-9]/.test(s), 'amount must be greater than zero')

/** Basis points, so 50 = 0.5%. Capped because a wide slippage is a real loss. */
export const slippageBpsSchema = z.number().int().min(1).max(500)

const base = {
  /**
   * Optional. When absent the scorer picks an account and states why — that is
   * the product. When present the user has overridden it.
   */
  fromAccount: accountIdSchema.optional(),
  /**
   * Why, in the person's words — "invoice 42", "rent". Part of the intent, so
   * it is part of the hash and the review page shows exactly what the agent
   * was told. Short, because it is a label, not a message.
   */
  note: z.string().trim().min(1).max(200).optional(),
}

/**
 * Every identifier in an intent must name the same chain.
 *
 * Validating each field on its own accepts a Base asset sent to a mainnet
 * recipient from a BNB account — three valid identifiers describing something
 * that cannot happen. Moving value between chains is a bridge, which is its own
 * intent with its own review.
 */
function chainsAgree(
  ids: readonly (string | undefined)[],
  parse: (id: string) => { namespace: string; reference: string },
): boolean {
  const chains = ids.filter((v): v is string => v !== undefined).map(parse)
  const first = chains[0]
  return first === undefined || chains.every((c) => sameChain(first, c))
}

const SAME_CHAIN = 'every asset and account in an intent must be on the same chain'

export const transferIntentSchema = z
  .object({
    ...base,
    kind: z.literal('transfer'),
    asset: assetIdSchema,
    amount: amountSchema,
    to: accountIdSchema,
    /**
     * The name the recipient was given as — "koshik.eth" — when `to` came
     * from resolving one. Hashed with the rest, so the page shows the name
     * next to the address it resolved to, and a plan cannot be re-pointed
     * while still claiming the name.
     */
    toName: z.string().trim().min(1).max(255).optional(),
  })
  .refine(
    (v) =>
      chainsAgree([v.asset], parseAssetId) &&
      chainsAgree([v.to, v.fromAccount], parseAccountId) &&
      sameChain(chainOf(parseAssetId(v.asset)), chainOf(parseAccountId(v.to))) &&
      (v.fromAccount === undefined ||
        sameChain(chainOf(parseAssetId(v.asset)), chainOf(parseAccountId(v.fromAccount)))),
    { message: SAME_CHAIN },
  )

export const swapIntentSchema = z
  .object({
    ...base,
    kind: z.literal('swap'),
    from: assetIdSchema,
    to: assetIdSchema,
    /** Exactly one side is fixed; the other is what the quote determines. */
    amountIn: amountSchema.optional(),
    amountOut: amountSchema.optional(),
    slippageBps: slippageBpsSchema.optional(),
  })
  .refine((v) => (v.amountIn === undefined) !== (v.amountOut === undefined), {
    message: 'give exactly one of amountIn or amountOut',
  })
  .refine(
    (v) =>
      sameChain(chainOf(parseAssetId(v.from)), chainOf(parseAssetId(v.to))) &&
      (v.fromAccount === undefined ||
        sameChain(chainOf(parseAssetId(v.from)), chainOf(parseAccountId(v.fromAccount)))),
    { message: `${SAME_CHAIN} — swapping across chains is a bridge` },
  )

/**
 * A bridge: the same question a swap asks, with the two assets on different
 * chains.
 *
 * Shaped exactly like a swap on purpose. It used to be `{asset, amount,
 * toChain}`, which could only move the same asset to another chain — so
 * "USDC on Base for ETH on mainnet", the thing people actually ask for, was
 * not expressible at all. With `from` and `to` it is, and the destination
 * chain is read off `to` rather than repeated in a field that could disagree
 * with it.
 *
 * The kind stays separate from `swap` even though the fields match, because
 * what differs is everything after the plan: a bridge is two chains, a wait,
 * and a source transaction confirming while the money is still in transit.
 * The review and the state machine need to know that, and the kind is the
 * cheapest place to carry it.
 */
export const bridgeIntentSchema = z
  .object({
    ...base,
    kind: z.literal('bridge'),
    from: assetIdSchema,
    to: assetIdSchema,
    /** Exactly one side is fixed; the other is what the route determines. */
    amountIn: amountSchema.optional(),
    amountOut: amountSchema.optional(),
    slippageBps: slippageBpsSchema.optional(),
  })
  .refine((v) => (v.amountIn === undefined) !== (v.amountOut === undefined), {
    message: 'give exactly one of amountIn or amountOut',
  })
  .refine(
    (v) =>
      v.fromAccount === undefined ||
      sameChain(chainOf(parseAssetId(v.from)), chainOf(parseAccountId(v.fromAccount))),
    { message: 'the source account must be on the same chain as the asset going in' },
  )
  .refine((v) => !sameChain(chainOf(parseAssetId(v.from)), chainOf(parseAssetId(v.to))), {
    message: 'a bridge must cross chains — source and destination are the same, which is a swap',
  })

export const supplyIntentSchema = z
  .object({
    ...base,
    kind: z.literal('supply'),
    asset: assetIdSchema,
    amount: amountSchema,
    protocol: z.string().min(1),
  })
  .refine(
    (v) =>
      v.fromAccount === undefined ||
      sameChain(chainOf(parseAssetId(v.asset)), chainOf(parseAccountId(v.fromAccount))),
    { message: SAME_CHAIN },
  )

export const intentSchema = z.union([
  transferIntentSchema,
  swapIntentSchema,
  bridgeIntentSchema,
  supplyIntentSchema,
])

export type TransferIntent = z.infer<typeof transferIntentSchema>
export type SwapIntent = z.infer<typeof swapIntentSchema>
export type BridgeIntent = z.infer<typeof bridgeIntentSchema>
/**
 * A swap or a bridge: identical fields, and the same question to a router.
 * Named so the policy and the tool can write one rule set for both and let
 * the chain comparison decide what differs.
 */
export type TradeIntent = SwapIntent | BridgeIntent
export type SupplyIntent = z.infer<typeof supplyIntentSchema>
export type Intent = z.infer<typeof intentSchema>

/**
 * The chain an intent executes on.
 *
 * For a bridge that is the source chain — the calls that need signing happen
 * there, and the destination is where value arrives afterwards.
 *
 * This is what binds a plan to the intent it claims to fulfil: the resolved
 * account and every call must be on this chain, or the plan executes something
 * other than what was asked for.
 */
export function sourceChainOf(intent: Intent): ChainId {
  return chainOf(parseAssetId(sourceAssetOf(intent)))
}

/** The asset that leaves. `from` for a trade, `asset` for everything else. */
export function sourceAssetOf(intent: Intent): string {
  return 'from' in intent ? intent.from : intent.asset
}

/**
 * Where the value ends up. The same chain as the source for everything except
 * a bridge, which is the whole point of a bridge.
 *
 * Read off the destination asset rather than a field of its own, so there is
 * no way for the two to disagree.
 */
export function destinationChainOf(intent: Intent): ChainId {
  // Keyed on the kind, not on whether a `to` exists: a transfer has one too,
  // and it is a CAIP-10 account rather than a CAIP-19 asset. Reading it as an
  // asset threw on every transfer.
  const trade = intent.kind === 'swap' || intent.kind === 'bridge'
  return chainOf(parseAssetId(trade ? intent.to : sourceAssetOf(intent)))
}

/** True when the value has to cross a chain boundary to arrive. */
export function crossesChains(intent: Intent): boolean {
  return !sameChain(sourceChainOf(intent), destinationChainOf(intent))
}
