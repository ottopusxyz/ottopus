import { randomUUID } from 'node:crypto'
import type { Portfolio } from '../connectors/portfolio/index.js'
import { RouteError, type RouteConnector, type RouteQuote } from '../connectors/route/index.js'
import {
  type PlanDraft,
  type SwapIntent,
  type WalletCandidate,
  type Warning,
  accountOn,
  chainName,
  findChain,
  isNativeAsset,
  nativeAssetIdOf,
  parseAccountId,
  parseAssetId,
  planDraftSchema,
  resolveSwapWallet,
  sourceChainOf,
  swapIntentSchema,
} from '../core/index.js'
import { assemblePlan } from '../core/index.js'
import { blockWarnings, decodeCalls, verifyPlan } from '../verify/index.js'
import type { Arm } from '../wallets/index.js'
import { humanAmount, truncateAddress } from './readable.js'
import type { PrepareContext, PrepareDeps } from './transfer.js'

/**
 * prepare_swap, end to end: intent, wallet, route, decode, verify, hash,
 * store, link.
 *
 * The shape is deliberately the transfer pipeline with one step inserted. A
 * transfer builds its own single call because there is nothing to decide; a
 * swap asks a router for calls it could not have written itself. Everything
 * after that — decode, verify, hash, no link without a pass — is identical,
 * because the security order does not change with the intent.
 *
 * The plan's clock is the quote's clock. A transfer expires when Ottopus says
 * so; a swap expires when the price it promised does, and pretending
 * otherwise would leave somebody signing a floor nobody still offers.
 */

/** A swap's own ceiling, when a quote lives longer than we want a link to. */
export const SWAP_PLAN_TTL_MS = 5 * 60_000

export interface SwapDeps extends PrepareDeps {
  /** Null on a deployment with no routing provider configured. */
  router: RouteConnector | null
}

export interface PrepareSwapInput {
  from: string
  to: string
  amountIn?: string | undefined
  amountOut?: string | undefined
  slippageBps?: number | undefined
  fromAccount?: string | undefined
  note?: string | undefined
}

export type SwapOutcome =
  | { kind: 'invalid'; reasons: string[] }
  | { kind: 'no_wallet'; reasons: string[] }
  | { kind: 'no_route'; reasons: string[] }
  | { kind: 'blocked'; planId: string; summary: string; reasons: string[]; warnings: Warning[] }
  | {
      kind: 'ready'
      planId: string
      status: 'awaiting_review'
      summary: string
      recommendedAccount: string
      reason: string
      route: string
      expectedOut: string
      minOut: string
      slippageBps: number | null
      feesUsd: string | null
      warnings: Warning[]
      expiresAt: string
      reviewUrl: string
      linkExpiresAt: string
    }

interface AssetWords {
  symbol: string
  decimals: number
}

/** What to call an asset. The portfolio knows; failing that, the chain's currency or the contract. */
function wordsFor(assetId: string, portfolio: Portfolio | null): AssetWords {
  const held = portfolio?.assets.find((a) => a.assetId.toLowerCase() === assetId.toLowerCase())
  if (held) return { symbol: held.asset.symbol, decimals: held.asset.decimals }
  const parsed = parseAssetId(assetId)
  const chain = { namespace: parsed.namespace, reference: parsed.reference }
  if (isNativeAsset(assetId)) {
    const info = findChain(chain)
    return info ? { symbol: info.nativeCurrency.symbol, decimals: info.nativeCurrency.decimals } : { symbol: 'units', decimals: 0 }
  }
  return { symbol: `units of ${truncateAddress(parsed.assetReference)}`, decimals: 0 }
}

function holdingOf(portfolio: Portfolio | null, assetId: string, walletId: string): bigint {
  const asset = portfolio?.assets.find((a) => a.assetId.toLowerCase() === assetId.toLowerCase())
  const holding = asset?.holdings.find((h) => h.walletId === walletId)
  return holding ? BigInt(holding.amount) : 0n
}

function candidatesFrom(
  arms: readonly Arm[],
  intent: SwapIntent,
  portfolio: Portfolio | null,
  gasAsset: string,
): WalletCandidate[] {
  const chain = sourceChainOf(intent)
  return arms
    .filter((arm) => arm.namespace === 'eip155')
    .map((arm) => ({
      walletId: arm.id,
      account: accountOn(chain, arm.address),
      label: arm.label,
      canSign: !arm.isWatchOnly && arm.provedAt !== null,
      assetBalance: holdingOf(portfolio, intent.from, arm.id),
      gasBalance: holdingOf(portfolio, gasAsset, arm.id),
    }))
}

export function swapSummary(
  intent: SwapIntent,
  quote: RouteQuote,
  from: AssetWords,
  to: AssetWords,
  signer: { label?: string | undefined; caip10: string },
): string {
  const paid = intent.amountIn
    ? `${humanAmount(intent.amountIn, from.decimals)} ${from.symbol}`
    : `${from.symbol}`
  const got = `${humanAmount(quote.expectedOut, to.decimals)} ${to.symbol}`
  const who = signer.label ?? truncateAddress(parseAccountId(signer.caip10).address)
  return `Swap ${paid} for about ${got} from ${who} on ${chainName(sourceChainOf(intent))}`
}

export async function prepareSwap(
  ctx: PrepareContext,
  deps: SwapDeps,
  input: PrepareSwapInput,
  now: Date = new Date(),
): Promise<SwapOutcome> {
  const parsed = swapIntentSchema.safeParse({
    kind: 'swap',
    from: input.from,
    to: input.to,
    ...(input.amountIn ? { amountIn: input.amountIn } : {}),
    ...(input.amountOut ? { amountOut: input.amountOut } : {}),
    ...(input.slippageBps !== undefined ? { slippageBps: input.slippageBps } : {}),
    ...(input.fromAccount ? { fromAccount: input.fromAccount } : {}),
    ...(input.note?.trim() ? { note: input.note.trim() } : {}),
  })
  if (!parsed.success) {
    return { kind: 'invalid', reasons: parsed.error.issues.map((i) => `${i.path.join('.') || 'intent'}: ${i.message}`) }
  }
  const intent = parsed.data
  const chain = sourceChainOf(intent)
  const chainId = `${chain.namespace}:${chain.reference}`
  if (!findChain(chain)) return { kind: 'invalid', reasons: [`chain ${chainId} is not one Ottopus knows`] }

  const gasAsset = nativeAssetIdOf(chain)
  if (!gasAsset) {
    return {
      kind: 'invalid',
      reasons: [
        `${chainName(chain)} (${chainId}) is not supported for swaps yet: Ottopus cannot name its native currency, ` +
          'so it cannot check for gas.',
      ],
    }
  }
  if (!deps.router) {
    return { kind: 'no_route', reasons: ['no routing provider is configured on this deployment, so no swap can be quoted'] }
  }
  if (!deps.router.serves(chainId, chainId)) {
    return { kind: 'no_route', reasons: [`${deps.router.name} does not route swaps on ${chainName(chain)}`] }
  }

  const arms = await deps.listWallets(ctx.userId)
  if (arms.length === 0) return { kind: 'no_wallet', reasons: ['no wallet is linked to this account'] }
  if (!deps.readPortfolio) {
    return { kind: 'no_wallet', reasons: ['balances are not available on this deployment, so no wallet can be chosen'] }
  }
  const portfolio = await deps.readPortfolio(
    arms.map((arm) => ({ walletId: arm.id, namespace: arm.namespace, address: arm.address })),
  )
  const fromWords = wordsFor(intent.from, portfolio)
  const toWords = wordsFor(intent.to, portfolio)
  const native = isNativeAsset(intent.from)
  const chosen = resolveSwapWallet({
    intent,
    candidates: candidatesFrom(arms, intent, portfolio, gasAsset),
    asset: fromWords,
    native,
  })
  if (!chosen.ok) return { kind: 'no_wallet', reasons: chosen.reasons }

  let quote: RouteQuote
  try {
    quote = await deps.router.route({
      fromAsset: intent.from,
      toAsset: intent.to,
      amountIn: intent.amountIn,
      amountOut: intent.amountOut,
      fromAccount: chosen.resolution.account.caip10,
      slippageBps: intent.slippageBps,
    })
  } catch (err) {
    if (err instanceof RouteError) return { kind: 'no_route', reasons: [err.message] }
    throw err
  }

  // The plan cannot outlive the price it quotes, and need not live as long.
  const quoteExpiry = Date.parse(quote.expiresAt)
  const ceiling = now.getTime() + SWAP_PLAN_TTL_MS
  const expiresAt = new Date(Math.min(Number.isFinite(quoteExpiry) ? quoteExpiry : ceiling, ceiling)).toISOString()

  const summary = swapSummary(intent, quote, fromWords, toWords, chosen.resolution.account)
  const floor = `At least ${humanAmount(quote.minOut, toWords.decimals)} ${toWords.symbol}, or it reverts`
  const draft: PlanDraft = planDraftSchema.parse({
    id: randomUUID(),
    version: 1,
    userId: ctx.userId,
    createdVia: 'agent',
    intent,
    provenance: 'route_provider',
    resolution: chosen.resolution,
    outcome: { type: 'calls', calls: quote.calls },
    quote: {
      provider: quote.provider,
      expiresAt,
      expectedOut: quote.expectedOut,
      minOut: quote.minOut,
    },
    humanPlan: {
      summary,
      steps: [...quote.steps, floor, ...(intent.note ? [`Note from the request: ${intent.note}`] : [])],
      feesUsd: quote.feesUsd ?? 'unknown',
      warnings: [],
      assets: [
        { id: intent.from, symbol: fromWords.symbol, decimals: fromWords.decimals },
        { id: intent.to, symbol: toWords.symbol, decimals: toWords.decimals },
      ],
    },
    status: 'awaiting_review',
    expiresAt,
  })

  const decodedActions = await decodeCalls(quote.calls, deps.lookups)
  const verdict = verifyPlan({
    intent,
    calls: quote.calls,
    decodedActions,
    // Exactly one spender may be approved: the one the route asked for. The
    // policy blocks any other, and checks it is the contract being called.
    allowedSpenders: quote.approval ? [quote.approval.spender] : [],
    quote: { expectedOut: quote.expectedOut, minOut: quote.minOut },
  })
  const warnings = blockWarnings(verdict)
  const plan = assemblePlan(
    { ...draft, status: verdict.ok ? 'awaiting_review' : 'blocked', humanPlan: { ...draft.humanPlan, warnings } },
    { decodedActions },
  )
  const record = await deps.createPlan({ plan, walletId: chosen.walletId, grantId: ctx.grantId })

  if (!verdict.ok) {
    return { kind: 'blocked', planId: record.plan.id, summary, reasons: verdict.reasons, warnings }
  }
  const link = await deps.issueReviewLink(record.plan.id, record.plan.version, record.plan.expiresAt)
  return {
    kind: 'ready',
    planId: record.plan.id,
    status: 'awaiting_review',
    summary,
    recommendedAccount: chosen.resolution.account.label
      ? `${chosen.resolution.account.label} (${truncateAddress(parseAccountId(chosen.resolution.account.caip10).address)})`
      : truncateAddress(parseAccountId(chosen.resolution.account.caip10).address),
    reason: chosen.resolution.reason,
    route: quote.steps.join(' → '),
    expectedOut: quote.expectedOut,
    minOut: quote.minOut,
    slippageBps: intent.slippageBps ?? null,
    feesUsd: quote.feesUsd,
    warnings,
    expiresAt: record.plan.expiresAt,
    reviewUrl: link.url,
    linkExpiresAt: link.expiresAt,
  }
}

/** The words the agent reads out. The structured copy carries the same facts. */
export function swapText(outcome: SwapOutcome): string {
  switch (outcome.kind) {
    case 'invalid':
      return `That is not a swap Ottopus can build:\n${outcome.reasons.map((r) => `- ${r}`).join('\n')}`
    case 'no_wallet':
      return `No linked wallet can make this swap:\n${outcome.reasons.map((r) => `- ${r}`).join('\n')}`
    case 'no_route':
      return `No route was found:\n${outcome.reasons.map((r) => `- ${r}`).join('\n')}`
    case 'blocked':
      return [
        `Ottopus refused to build "${outcome.summary}":`,
        ...outcome.reasons.map((r) => `- ${r}`),
        'The refusal is recorded in Activity. Nothing was swapped.',
      ].join('\n')
    case 'ready':
      return [
        `Plan ready: ${outcome.summary}.`,
        outcome.reason,
        `Route: ${outcome.route}.`,
        ...outcome.warnings.map((w) => `Heads up: ${w.message}`),
        `Review and sign: ${outcome.reviewUrl}`,
        `The quote holds until ${outcome.expiresAt}. Nothing moves until the person signs in their own wallet.`,
      ].join('\n')
  }
}
