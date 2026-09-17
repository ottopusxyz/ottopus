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

/** Stretch capabilities. Defined now so the plan format does not change later. */
export const bridgeIntentSchema = z
  .object({
    ...base,
    kind: z.literal('bridge'),
    asset: assetIdSchema,
    amount: amountSchema,
    toChain: chainIdSchema,
  })
  .refine(
    (v) =>
      v.fromAccount === undefined ||
      sameChain(chainOf(parseAssetId(v.asset)), chainOf(parseAccountId(v.fromAccount))),
    { message: 'the source account must be on the same chain as the asset' },
  )
  .refine((v) => !sameChain(chainOf(parseAssetId(v.asset)), parseChainId(v.toChain)), {
    message: 'a bridge must cross chains — source and destination are the same',
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
  return chainOf(parseAssetId(intent.kind === 'swap' ? intent.from : intent.asset))
}
