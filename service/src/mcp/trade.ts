import { randomUUID } from 'node:crypto'
import type { Portfolio } from '../connectors/portfolio/index.js'
import { RouteError, type RouteConnector, type RouteQuote } from '../connectors/route/index.js'
import type { TokenRegistry } from '../connectors/tokens/index.js'
import {
  type PlanDraft,
  type TradeIntent,
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
  bridgeIntentSchema,
  crossesChains,
  destinationChainOf,
  resolveTradeWallet,
  sourceChainOf,
  swapIntentSchema,
} from '../core/index.js'
import { assemblePlan } from '../core/index.js'
import { blockWarnings, decodeCalls, verifyPlan } from '../verify/index.js'
import type { Arm } from '../wallets/index.js'
import { humanAmount, resolveWallet, truncateAddress } from './readable.js'
import type { PrepareContext, PrepareDeps } from './transfer.js'

/**
 * prepare_trade, end to end: intent, wallet, route, decode, verify, hash,
 * store, link. One tool for a swap and a bridge.
 *
 * One tool because the split leaked our vocabulary to the agent. Ask for ETH
 * on Arbitrum using Base USDC and there is no honest answer to "is that a
 * swap or a bridge" — it is both — and the old `prepare_swap` refused the
 * pair by naming a tool that did not exist. Here the chains are compared and
 * the intent kind follows, so the agent describes what it wants and Ottopus
 * decides what that is.
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

/** A trade's own ceiling, when a quote lives longer than we want a link to. */
export const TRADE_PLAN_TTL_MS = 5 * 60_000

export interface SwapDeps extends PrepareDeps {
  /** Null on a deployment with no routing provider configured. */
  router: RouteConnector | null
  /**
   * What an asset is called when the portfolio has never seen it, which for
   * the receiving side of a trade is the normal case. Null degrades the
   * words, never the plan.
   */
  tokens: TokenRegistry | null
}

export interface PrepareTradeInput {
  from: string
  to: string
  amountIn?: string | undefined
  amountOut?: string | undefined
  slippageBps?: number | undefined
  fromAccount?: string | undefined
  note?: string | undefined
}

export type TradeOutcome =
  | { kind: 'invalid'; reasons: string[] }
  | { kind: 'no_wallet'; reasons: string[] }
  | { kind: 'no_route'; reasons: string[] }
  | { kind: 'blocked'; planId: string; summary: string; reasons: string[]; warnings: Warning[] }
  | {
      kind: 'ready'
      planId: string
      status: 'awaiting_review'
      /** Which shape it turned out to be, since the caller did not have to say. */
      trade: 'swap' | 'bridge'
      summary: string
      recommendedAccount: string
      reason: string
      route: string
      /** The provider's estimate of how long it takes, in seconds. */
      etaSeconds: number | null
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

/**
 * What to call an asset.
 *
 * The portfolio first, because it is what the person actually holds and it
 * is priced. Then the token registry, which is the only source for the side
 * of a trade they do not have yet — and getting that wrong is not cosmetic:
 * the summary is hashed, so a swap into an unheld token was permanently
 * recorded as "9,500,037,168,996,562,157 units of 0x4ed4…efed" rather than
 * "9.5 DEGEN". The last resort stays, and now means nobody at all knows this
 * token.
 */
export async function wordsFor(
  assetId: string,
  portfolio: Portfolio | null,
  tokens: TokenRegistry | null,
): Promise<AssetWords> {
  const held = portfolio?.assets.find((a) => a.assetId.toLowerCase() === assetId.toLowerCase())
  if (held) return { symbol: held.asset.symbol, decimals: held.asset.decimals }
  const known = await tokens?.byAssetId(assetId)
  if (known) return { symbol: known.symbol, decimals: known.decimals }
  const parsed = parseAssetId(assetId)
  if (isNativeAsset(assetId)) {
    const info = findChain({ namespace: parsed.namespace, reference: parsed.reference })
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
  intent: TradeIntent,
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

export function tradeSummary(
  intent: TradeIntent,
  quote: RouteQuote,
  from: AssetWords,
  to: AssetWords,
  signer: { label?: string | undefined; caip10: string },
): string {
  const paid = intent.amountIn ? `${humanAmount(intent.amountIn, from.decimals)} ${from.symbol}` : from.symbol
  const got = `${humanAmount(quote.expectedOut, to.decimals)} ${to.symbol}`
  const who = signer.label ?? truncateAddress(parseAccountId(signer.caip10).address)
  const source = chainName(sourceChainOf(intent))
  if (!crossesChains(intent)) return `Swap ${paid} for about ${got} from ${who} on ${source}`
  // Both chains named, because which one it lands on is the whole point.
  return `Bridge ${paid} on ${source} for about ${got} on ${chainName(destinationChainOf(intent))} from ${who}`
}

export async function prepareTrade(
  ctx: PrepareContext,
  deps: SwapDeps,
  input: PrepareTradeInput,
  now: Date = new Date(),
): Promise<TradeOutcome> {
  // The chains decide what this is. Read before the intent is parsed, because
  // which schema parses it depends on the answer.
  let crossing: boolean
  try {
    const a = parseAssetId(input.from)
    const b = parseAssetId(input.to)
    crossing = a.namespace !== b.namespace || a.reference !== b.reference
  } catch {
    return {
      kind: 'invalid',
      reasons: ['from and to must both be CAIP-19 asset ids, exactly as get_portfolio lists them under assetId'],
    }
  }
  const arms = await deps.listWallets(ctx.userId)
  let fromAccount: string | undefined
  if (input.fromAccount) {
    const match = resolveWallet(arms, input.fromAccount)
    if (!match.ok) return { kind: 'no_wallet', reasons: [match.reason] }
    const a = parseAssetId(input.from)
    fromAccount = accountOn({ namespace: a.namespace, reference: a.reference }, match.arm.address)
  }

  const parsed = (crossing ? bridgeIntentSchema : swapIntentSchema).safeParse({
    kind: crossing ? 'bridge' : 'swap',
    from: input.from,
    to: input.to,
    ...(input.amountIn ? { amountIn: input.amountIn } : {}),
    ...(input.amountOut ? { amountOut: input.amountOut } : {}),
    ...(input.slippageBps !== undefined ? { slippageBps: input.slippageBps } : {}),
    ...(fromAccount ? { fromAccount } : {}),
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
        `${chainName(chain)} (${chainId}) is not supported for trades yet: Ottopus cannot name its native currency, ` +
          'so it cannot check for gas.',
      ],
    }
  }
  if (!deps.router) {
    return { kind: 'no_route', reasons: ['no routing provider is configured on this deployment, so no swap can be quoted'] }
  }
  const destination = destinationChainOf(intent)
  const destinationId = `${destination.namespace}:${destination.reference}`
  if (!findChain(destination)) {
    return { kind: 'invalid', reasons: [`chain ${destinationId} is not one Ottopus knows`] }
  }
  if (!deps.router.serves(chainId, destinationId)) {
    return {
      kind: 'no_route',
      reasons: [
        crossing
          ? `${deps.router.name} does not route from ${chainName(chain)} to ${chainName(destination)}`
          : `${deps.router.name} does not route swaps on ${chainName(chain)}`,
      ],
    }
  }

  if (arms.length === 0) return { kind: 'no_wallet', reasons: ['no wallet is linked to this account'] }
  if (!deps.readPortfolio) {
    return { kind: 'no_wallet', reasons: ['balances are not available on this deployment, so no wallet can be chosen'] }
  }
  const portfolio = await deps.readPortfolio(
    arms.map((arm) => ({ walletId: arm.id, namespace: arm.namespace, address: arm.address })),
  )
  // Both sides in one round trip: the registry caches, and the receiving
  // side is the one the portfolio cannot answer.
  const [fromWords, toWords] = await Promise.all([
    wordsFor(intent.from, portfolio, deps.tokens),
    wordsFor(intent.to, portfolio, deps.tokens),
  ])
  const native = isNativeAsset(intent.from)
  const chosen = resolveTradeWallet({
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
  const ceiling = now.getTime() + TRADE_PLAN_TTL_MS
  const expiresAt = new Date(Math.min(Number.isFinite(quoteExpiry) ? quoteExpiry : ceiling, ceiling)).toISOString()

  const summary = tradeSummary(intent, quote, fromWords, toWords, chosen.resolution.account)
  const floor = crossing
    ? `At least ${humanAmount(quote.minOut, toWords.decimals)} ${toWords.symbol} arriving on ${chainName(destination)}`
    : `At least ${humanAmount(quote.minOut, toWords.decimals)} ${toWords.symbol}, or it reverts`
  // Arrival is the bridge's promise. Saying whose estimate it is matters more
  // than the number: Ottopus cannot make it true and does not watch it yet.
  const arrival = crossing
    ? [
        quote.etaSeconds === null
          ? `${quote.provider} does not estimate how long the crossing takes. Arrival is the bridge's promise, not Ottopus's.`
          : `${quote.provider} estimates ${durationWords(quote.etaSeconds)} to arrive. That is the bridge's estimate, not Ottopus's.`,
      ]
    : []
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
      steps: [...quote.steps, floor, ...arrival, ...(intent.note ? [`Note from the request: ${intent.note}`] : [])],
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
    quote: { expectedOut: quote.expectedOut, minOut: quote.minOut, nativeFee: quote.nativeFee },
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
    trade: crossing ? 'bridge' : 'swap',
    summary,
    recommendedAccount: chosen.resolution.account.label
      ? `${chosen.resolution.account.label} (${truncateAddress(parseAccountId(chosen.resolution.account.caip10).address)})`
      : truncateAddress(parseAccountId(chosen.resolution.account.caip10).address),
    reason: chosen.resolution.reason,
    route: quote.steps.join(' → '),
    etaSeconds: quote.etaSeconds,
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

/** Seconds as something a person reads. Rounded: nobody needs 187 seconds. */
export function durationWords(seconds: number): string {
  if (seconds < 90) return `about ${Math.max(1, Math.round(seconds))} seconds`
  const minutes = Math.round(seconds / 60)
  if (minutes < 90) return `about ${minutes} minutes`
  return `about ${Math.round(minutes / 60)} hours`
}

/** The words the agent reads out. The structured copy carries the same facts. */
export function tradeText(outcome: TradeOutcome): string {
  switch (outcome.kind) {
    case 'invalid':
      return `That is not a trade Ottopus can build:\n${outcome.reasons.map((r) => `- ${r}`).join('\n')}`
    case 'no_wallet':
      return `No linked wallet can make this trade:\n${outcome.reasons.map((r) => `- ${r}`).join('\n')}`
    case 'no_route':
      return `No route was found:\n${outcome.reasons.map((r) => `- ${r}`).join('\n')}`
    case 'blocked':
      return [
        `Ottopus refused to build "${outcome.summary}":`,
        ...outcome.reasons.map((r) => `- ${r}`),
        'The refusal is recorded in Activity. Nothing was traded.',
      ].join('\n')
    case 'ready':
      return [
        `Plan ready: ${outcome.summary}.`,
        outcome.reason,
        `Route: ${outcome.route}.`,
        ...(outcome.trade === 'bridge'
          ? ['This crosses chains: the source transaction confirms first and the funds arrive after that.']
          : []),
        ...outcome.warnings.map((w) => `Heads up: ${w.message}`),
        `Review and sign: ${outcome.reviewUrl}`,
        `The quote holds until ${outcome.expiresAt}. Nothing moves until the person signs in their own wallet.`,
      ].join('\n')
  }
}
