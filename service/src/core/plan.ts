import { z } from 'zod'
import { accountIdSchema, assetIdSchema, chainIdSchema, chainOf, parseAccountId, parseChainId, sameChain } from './caip.js'
import { intentSchema, sourceChainOf } from './intent.js'

/**
 * The plan format. Shape only — hashing and the state machine are separate, and
 * nothing here may be mutated once a plan reaches review.
 *
 * Mirrors the Plan type in the canonical plan doc. The status vocabulary is
 * frozen and must match the check constraint in src/db/schema.ts exactly; drift
 * between the three breaks MCP responses, activity filters and the review UI at
 * the same time.
 */

export const PLAN_STATUSES = [
  'draft',
  'awaiting_review',
  'awaiting_signature',
  'submitted',
  'confirmed',
  'failed',
  'expired',
  'blocked',
  'superseded',
  'cancelled',
] as const

export const planStatusSchema = z.enum(PLAN_STATUSES)
export type PlanStatus = z.infer<typeof planStatusSchema>

/** Statuses a plan can never leave. Nothing may be signed from one of these. */
export const TERMINAL_STATUSES = [
  'confirmed',
  'failed',
  'expired',
  'blocked',
  'superseded',
  'cancelled',
] as const satisfies readonly PlanStatus[]

export function isTerminal(status: PlanStatus): boolean {
  return (TERMINAL_STATUSES as readonly PlanStatus[]).includes(status)
}

/** 0x-prefixed hex, lowercased. Calldata compared case-sensitively is a bug. */
const hexSchema = z
  .string()
  .regex(/^0x[0-9a-fA-F]*$/, 'expected 0x-prefixed hex')
  .transform((s) => s.toLowerCase())

export const callSchema = z
  .strictObject({
    to: accountIdSchema,
    /** Wei as a decimal string, for the same reason amounts are strings. */
    value: z.string().regex(/^[0-9]+$/),
    data: hexSchema,
    chainId: chainIdSchema,
  })
  // A target on one chain with chainId naming another is a transaction sent to
  // whatever happens to live at that address on the wrong network.
  .refine((c) => sameChain(chainOf(parseAccountId(c.to)), parseChainId(c.chainId)), {
    message: 'call target and chainId must name the same chain',
  })

/**
 * Where the calls came from. Agent-crafted plans get a heightened policy tier
 * and a distinct badge on review — the user must be able to see that no route
 * provider stood behind this.
 */
export const provenanceSchema = z.enum(['route_provider', 'agent_crafted'])

export const warningSchema = z.object({
  severity: z.enum(['info', 'caution', 'block']),
  code: z.string().min(1),
  message: z.string().min(1),
  /** What to do instead. A warning with no alternative just induces clicking. */
  saferAlternative: z.string().optional(),
})

export const candidateSummarySchema = z.object({
  account: accountIdSchema,
  label: z.string().optional(),
  /** Why this one lost, in plain language. Shown, so it is stored. */
  reason: z.string().min(1),
})

export const resolutionSchema = z.object({
  account: z.object({ caip10: accountIdSchema, label: z.string().optional() }),
  candidatesConsidered: z.array(candidateSummarySchema),
  reason: z.string().min(1),
})

/**
 * MVP ships "calls". The other two are reserved so adding them later is not a
 * plan-format change — which would invalidate every stored planHash.
 */
export const outcomeSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('calls'), calls: z.array(callSchema).min(1) }),
  z.object({ type: z.literal('signature'), eip712: z.unknown() }),
  z.object({ type: z.literal('permission'), request: z.unknown() }),
])

export const quoteSchema = z.object({
  provider: z.string().min(1),
  expiresAt: z.iso.datetime(),
  expectedOut: z.string().optional(),
  minOut: z.string().optional(),
})

export const humanPlanSchema = z.object({
  summary: z.string().min(1),
  steps: z.array(z.string()),
  feesUsd: z.string(),
  warnings: z.array(warningSchema),
  /**
   * What to call each asset the plan moves. Display data, hashed with the
   * rest: a page that read "500 USDC" over calls moving 500 of something else
   * would be the summary lying, and the hash is what stops the summary lying.
   * Optional because plans stored before it existed have none.
   */
  assets: z
    .array(z.strictObject({ id: assetIdSchema, symbol: z.string().min(1), decimals: z.number().int().min(0).max(36) }))
    .optional(),
})

/**
 * What the decoder (#18) says a call does. Evidence, shown on the review page
 * and checked by verify (#77); not part of the hash, because the calls are, and
 * the decoding is derived from them.
 */
export const decodedActionSchema = z.strictObject({
  target: accountIdSchema,
  /** Whether the target has code. A wallet address is not an unverified contract. */
  isContract: z.boolean(),
  /**
   * Where the ABI came from. "native" is a value transfer with no calldata;
   * "unknown" means raw calldata with a warning.
   */
  source: z.enum(['native', 'abi', 'sourcify', '4byte', 'unknown']),
  /** Verified source on Sourcify. Never true for a wallet address. */
  verified: z.boolean(),
  contractName: z.string().optional(),
  /** Signature, e.g. "transfer(address,uint256)"; "nativeTransfer()"; or "unknown". */
  function: z.string().min(1),
  args: z.array(z.strictObject({ name: z.string(), type: z.string(), value: z.string() })),
  /** Native value, wei as a decimal string. */
  value: z.string().regex(/^[0-9]+$/),
  approval: z
    .strictObject({
      spender: accountIdSchema,
      /** Base units as a string, or "unlimited" — which is a warning, never a default. */
      amount: z.union([z.string().regex(/^[0-9]+$/), z.literal('unlimited')]),
    })
    .optional(),
})

/**
 * What one asset did to one balance, as a simulation observed it.
 *
 * Signed base units, so a row carries its own direction and nothing has to
 * infer it from the intent: `-500000000` left, `+1200000000000000` arrived.
 * `pre` and `post` are kept because "500 of 500 USDC" and "500 of 40,000
 * USDC" are different sentences, and the page can only say the first if it
 * knows what was there before.
 *
 * The symbol and decimals are the simulator's reading of the token, which is
 * why they are nullable: an unlabelled contract is a real answer, and a row
 * with no words is still a row worth showing as raw units.
 */
export const assetDeltaSchema = z.strictObject({
  assetId: assetIdSchema,
  symbol: z.string().nullable(),
  decimals: z.number().int().min(0).max(36).nullable(),
  /** Signed base units. Negative leaves the account. */
  diff: z.string().regex(/^-?[0-9]+$/),
  pre: z.string().regex(/^[0-9]+$/),
  post: z.string().regex(/^[0-9]+$/),
})

/**
 * One simulation run. A prediction, never a guarantee, and never from the
 * provider that built the route (invariant 4). Null on a plan whose chain no
 * simulator serves; a transfer can still be reviewed from its decoded intent.
 *
 * Evidence, not payload: the hash does not cover it (see hash.ts), so a plan
 * can be re-simulated on open and before submit — which is what #24 needs —
 * without the review page's binding changing under the person reading it.
 */
export const simulationSchema = z.strictObject({
  provider: z.string().min(1),
  chainId: chainIdSchema,
  blockNumber: z.string().regex(/^[0-9]+$/),
  success: z.boolean(),
  /** Every balance the run moved, for the account that signs. */
  assetChanges: z.array(assetDeltaSchema),
  /**
   * Whether balances were traced at all — accepted, and nothing reads it yet.
   *
   * It is here because plans on record carry it. It shipped, wrote itself
   * into four stored simulations, and was then reverted out of the schema
   * (#92) — at which point `parsePlan` began throwing `unrecognized_keys` on
   * those rows and the whole plans list stopped loading. This object is
   * strict on purpose, so a key it has ever written it must accept forever;
   * removing one is a breaking read, not a tidy-up.
   *
   * Optional, so simulations written before it existed parse too. #92 is
   * where it gets a reader: an empty `assetChanges` means two different
   * things — "traced, and nothing moved" or "never looked" — and a policy
   * cannot tell a swap that received nothing from a swap nobody watched
   * without it.
   */
  tracedAssets: z.boolean().optional(),
  /** Gas units the whole batch burned. */
  gasUsed: z.string().regex(/^[0-9]+$/),
  /** The same in dollars, or "unknown" when no price was to hand. */
  gasUsd: z.string(),
  revertReason: z.string().optional(),
  /** Which call reverted, 1-based, when one did. */
  failedCall: z.number().int().positive().optional(),
  resultHash: z.string().min(1),
  ranAt: z.iso.datetime(),
})

/** 32 bytes of SHA-256, lowercase hex, no prefix. Computed in core, never in web. */
export const planHashSchema = z.string().regex(/^[0-9a-f]{64}$/, 'expected a sha256 hex digest')

/**
 * The fields a plan has before verification: routed and explained, but not yet
 * hashed, decoded or simulated. Strict, so an unexpected key is an error rather
 * than silent data loss — zod strips unknown keys by default, and the keys it
 * would strip from a complete plan are the security-relevant ones.
 */
const draftFields = z.strictObject({
  id: z.uuid(),
  /** A replacement bumps this and kills the old review link. */
  version: z.number().int().positive(),
  userId: z.uuid(),
  createdVia: z.enum(['agent', 'web']),
  intent: intentSchema,
  provenance: provenanceSchema,
  resolution: resolutionSchema,
  outcome: outcomeSchema,
  quote: quoteSchema,
  humanPlan: humanPlanSchema,
  status: planStatusSchema,
  expiresAt: z.iso.datetime(),
})

type DraftFields = z.infer<typeof draftFields>

/**
 * The bindings that hold a plan together. Applied to the draft and to the
 * complete plan alike, so a plan cannot pass as complete what it would have
 * failed as a draft.
 */
function bound<S extends z.ZodType<DraftFields>>(schema: S): S {
  return schema
    // The plan names one account and signing is gated on it, so a call on
    // another chain could never be signed by the account the review page bound.
    .refine(
      (p: DraftFields) =>
        p.outcome.type !== 'calls' ||
        p.outcome.calls.every((c) =>
          sameChain(chainOf(parseAccountId(p.resolution.account.caip10)), parseChainId(c.chainId)),
        ),
      { message: 'every call must be on the same chain as the resolved account' },
    )
    /**
     * Bind the plan to the intent it claims to fulfil.
     *
     * The resolution and the calls agreeing with each other is not enough: they
     * can be internally consistent and still execute something the user never
     * asked for — a Base transfer resolved against an Ethereum account, with
     * Ethereum calls. This is the relationship planHash exists to secure, so it
     * has to hold before anything is hashed.
     */
    .refine(
      (p: DraftFields) =>
        sameChain(sourceChainOf(p.intent), chainOf(parseAccountId(p.resolution.account.caip10))),
      { message: 'the resolved account must be on the chain the intent executes on' },
    )
    .refine(
      (p: DraftFields) =>
        p.outcome.type !== 'calls' ||
        p.outcome.calls.every((c) => sameChain(sourceChainOf(p.intent), parseChainId(c.chainId))),
      { message: 'every call must be on the chain the intent executes on' },
    ) as S
}

export const planDraftSchema = bound(draftFields)

/**
 * The complete plan: a draft plus its hash and its evidence. Parsing one does
 * not check the hash — that needs the hash function, which lives in hash.ts to
 * keep this module free of crypto. Use `parsePlan` there for anything read back
 * from storage.
 */
export const planSchema = bound(
  draftFields.extend({
    planHash: planHashSchema,
    decodedActions: z.array(decodedActionSchema),
    simulation: simulationSchema.nullable(),
  }),
)

export type PlanDraft = z.infer<typeof planDraftSchema>
export type Plan = z.infer<typeof planSchema>
export type DecodedAction = z.infer<typeof decodedActionSchema>
export type Simulation = z.infer<typeof simulationSchema>
export type AssetDelta = z.infer<typeof assetDeltaSchema>
export type Call = z.infer<typeof callSchema>
export type Warning = z.infer<typeof warningSchema>
export type Outcome = z.infer<typeof outcomeSchema>
