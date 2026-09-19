import { randomUUID } from 'node:crypto'
import { encodeFunctionData } from 'viem'
import type { ArmRef, Portfolio } from '../connectors/portfolio/index.js'
import {
  type Call,
  type PlanDraft,
  type TransferIntent,
  type WalletCandidate,
  type Warning,
  accountOn,
  assemblePlan,
  chainName,
  findChain,
  isNativeAsset,
  nativeAssetIdOf,
  parseAccountId,
  parseAssetId,
  planDraftSchema,
  resolveTransferWallet,
  sourceChainOf,
  transferIntentSchema,
} from '../core/index.js'
import type { CreatePlanInput, PlanRecord, ReviewLink } from '../plans/index.js'
import { KNOWN_ABI, type Lookups, blockWarnings, decodeCalls, verifyPlan } from '../verify/index.js'
import type { Arm } from '../wallets/index.js'
import { humanAmount, truncateAddress } from './readable.js'

/**
 * prepare_transfer, end to end: intent, wallet, one call, decode, verify,
 * hash, store, link. Nothing here signs; the last thing it does is hand back
 * a URL a person opens.
 *
 * Kept out of server.ts so the tool registration stays a registration and
 * this can be tested as a function. The order is the security order — verify
 * runs between decode and hash, so a plan that fails never has a hash and
 * never has a link.
 */

/** A transfer carries no quote, so this is the plan's whole clock. */
export const PLAN_TTL_MS = 15 * 60_000

export interface PrepareDeps {
  listWallets(userId: string): Promise<Arm[]>
  readPortfolio: ((arms: readonly ArmRef[]) => Promise<Portfolio>) | null
  lookups: Lookups
  createPlan(input: CreatePlanInput): Promise<PlanRecord>
  issueReviewLink(planId: string, version: number, planExpiresAt: string): Promise<ReviewLink>
}

export interface PrepareContext {
  userId: string
  grantId: string | null
}

export interface PrepareInput {
  asset: string
  amount: string
  to: string
  fromAccount?: string | undefined
  note?: string | undefined
}

export type PrepareOutcome =
  | { kind: 'invalid'; reasons: string[] }
  | { kind: 'no_wallet'; reasons: string[] }
  | { kind: 'blocked'; planId: string; summary: string; reasons: string[]; warnings: Warning[] }
  | {
      kind: 'ready'
      planId: string
      status: 'awaiting_review'
      summary: string
      recommendedAccount: string
      reason: string
      warnings: Warning[]
      expiresAt: string
      reviewUrl: string
      linkExpiresAt: string
    }

/** One call. Native value to the recipient, or ERC-20 transfer on the token. */
export function buildTransferCall(intent: TransferIntent): Call {
  const chainId = sourceChainOf(intent)
  const chain = `${chainId.namespace}:${chainId.reference}`
  if (isNativeAsset(intent.asset)) {
    return { to: intent.to, value: intent.amount, data: '0x', chainId: chain }
  }
  const token = parseAssetId(intent.asset).assetReference
  const recipient = parseAccountId(intent.to).address
  return {
    to: accountOn(chainId, token),
    value: '0',
    data: encodeFunctionData({
      abi: KNOWN_ABI,
      functionName: 'transfer',
      args: [recipient as `0x${string}`, BigInt(intent.amount)],
    }).toLowerCase(),
    chainId: chain,
  }
}

interface AssetWords {
  symbol: string
  decimals: number
}

/** What to call the asset. The portfolio knows; failing that, the chain's own currency or the contract. */
function assetWords(intent: TransferIntent, portfolio: Portfolio | null): AssetWords {
  const held = portfolio?.assets.find((a) => a.assetId.toLowerCase() === intent.asset.toLowerCase())
  if (held) return { symbol: held.asset.symbol, decimals: held.asset.decimals }
  const chain = sourceChainOf(intent)
  if (isNativeAsset(intent.asset)) {
    const info = findChain(chain)
    return info ? { symbol: info.nativeCurrency.symbol, decimals: info.nativeCurrency.decimals } : { symbol: 'units', decimals: 0 }
  }
  return { symbol: `units of ${truncateAddress(parseAssetId(intent.asset).assetReference)}`, decimals: 0 }
}

function holdingOf(portfolio: Portfolio | null, assetId: string, walletId: string): bigint {
  const asset = portfolio?.assets.find((a) => a.assetId.toLowerCase() === assetId.toLowerCase())
  const holding = asset?.holdings.find((h) => h.walletId === walletId)
  return holding ? BigInt(holding.amount) : 0n
}

/** Every EVM wallet, as a candidate on the intent's chain. */
function candidatesFrom(
  arms: readonly Arm[],
  intent: TransferIntent,
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
      assetBalance: holdingOf(portfolio, intent.asset, arm.id),
      gasBalance: holdingOf(portfolio, gasAsset, arm.id),
    }))
}

export function transferSummary(intent: TransferIntent, asset: AssetWords, from: { label?: string | undefined; caip10: string }): string {
  const amount = `${humanAmount(intent.amount, asset.decimals)} ${asset.symbol}`
  const address = truncateAddress(parseAccountId(intent.to).address)
  const to = intent.toName ? `${intent.toName} (${address})` : address
  const fromName = from.label ?? truncateAddress(parseAccountId(from.caip10).address)
  return `Send ${amount} to ${to} from ${fromName} on ${chainName(sourceChainOf(intent))}`
}

/** Looks like an ENS name rather than an address or a CAIP-10. */
const ENS_NAME = /^[^\s:/]+\.[a-z]{2,}$/i

/**
 * `to` may be a CAIP-10, a bare 0x address, or an ENS name. A name resolves
 * on Ethereum and the address it gives is used on the intent's chain — the
 * same account, as an EOA is the same on every EVM chain. The name is kept
 * on the intent so the page shows both and the hash covers the pairing.
 */
async function recipientOf(
  to: string,
  chainId: string,
  lookups: Lookups,
): Promise<{ to: string; toName?: string } | { error: string }> {
  const trimmed = to.trim()
  if (/^0x[0-9a-fA-F]{40}$/.test(trimmed)) return { to: `${chainId}:${trimmed.toLowerCase()}` }
  if (!ENS_NAME.test(trimmed)) return { to: trimmed }
  // ENS names are case-insensitive; the registry normalises further.
  const name = trimmed.toLowerCase()
  const address = await lookups.resolveName(name)
  if (!address) return { error: `${name} does not resolve to an address on ENS` }
  return { to: `${chainId}:${address}`, toName: name }
}

export async function prepareTransfer(
  ctx: PrepareContext,
  deps: PrepareDeps,
  input: PrepareInput,
  now: Date = new Date(),
): Promise<PrepareOutcome> {
  // The chain comes from the asset, so a recipient given by name or bare
  // address can be placed on it before the intent is parsed as a whole.
  let assetChain: string
  try {
    const parsedAsset = parseAssetId(input.asset)
    assetChain = `${parsedAsset.namespace}:${parsedAsset.reference}`
  } catch {
    return { kind: 'invalid', reasons: [`asset: ${input.asset} is not a CAIP-19 asset id; get_portfolio lists each holding's assetId`] }
  }
  const recipient = await recipientOf(input.to, assetChain, deps.lookups)
  if ('error' in recipient) return { kind: 'invalid', reasons: [recipient.error] }

  const parsed = transferIntentSchema.safeParse({
    kind: 'transfer',
    asset: input.asset,
    amount: input.amount,
    to: recipient.to,
    ...(recipient.toName ? { toName: recipient.toName } : {}),
    ...(input.fromAccount ? { fromAccount: input.fromAccount } : {}),
    ...(input.note?.trim() ? { note: input.note.trim() } : {}),
  })
  if (!parsed.success) {
    return { kind: 'invalid', reasons: parsed.error.issues.map((i) => `${i.path.join('.') || 'intent'}: ${i.message}`) }
  }
  const intent = parsed.data
  const chain = sourceChainOf(intent)
  const chainId = `${chain.namespace}:${chain.reference}`
  if (!findChain(chain)) {
    return { kind: 'invalid', reasons: [`chain ${chainId} is not one Ottopus knows`] }
  }
  // Gas is paid in the chain's own currency, so a transfer needs its name.
  // A chain whose coin type is not on file is refused here, in a sentence,
  // rather than three steps later as an exception.
  const gasAsset = nativeAssetIdOf(chain)
  if (!gasAsset) {
    return {
      kind: 'invalid',
      reasons: [
        `${chainName(chain)} (${chainId}) is not supported for transfers yet: Ottopus cannot name its native currency, ` +
          'so it cannot check for gas. Base, Ethereum, Arbitrum, Optimism, Polygon and BNB Chain are supported.',
      ],
    }
  }

  // Balances decide eligibility. Without a provider nothing can be known
  // about what a wallet holds, and a plan built on a guess is not a plan.
  const arms = await deps.listWallets(ctx.userId)
  if (arms.length === 0) return { kind: 'no_wallet', reasons: ['no wallet is linked to this account'] }
  if (!deps.readPortfolio) {
    return { kind: 'no_wallet', reasons: ['balances are not available on this deployment, so no wallet can be chosen'] }
  }
  const portfolio = await deps.readPortfolio(
    arms.map((arm) => ({ walletId: arm.id, namespace: arm.namespace, address: arm.address })),
  )
  const asset = assetWords(intent, portfolio)
  const native = isNativeAsset(intent.asset)
  const chosen = resolveTransferWallet({ intent, candidates: candidatesFrom(arms, intent, portfolio, gasAsset), asset, native })
  if (!chosen.ok) return { kind: 'no_wallet', reasons: chosen.reasons }

  const call = buildTransferCall(intent)
  const expiresAt = new Date(now.getTime() + PLAN_TTL_MS).toISOString()
  const summary = transferSummary(intent, asset, chosen.resolution.account)
  const draft: PlanDraft = planDraftSchema.parse({
    id: randomUUID(),
    version: 1,
    userId: ctx.userId,
    createdVia: 'agent',
    intent,
    provenance: 'route_provider',
    resolution: chosen.resolution,
    outcome: { type: 'calls', calls: [call] },
    quote: { provider: 'ottopus', expiresAt },
    humanPlan: {
      summary,
      steps: [summary, ...(intent.note ? [`Note from the request: ${intent.note}`] : [])],
      // Gas is estimated by simulation (#23); until then the page says so.
      feesUsd: 'unknown',
      warnings: [],
      assets: [{ id: intent.asset, symbol: asset.symbol, decimals: asset.decimals }],
    },
    status: 'awaiting_review',
    expiresAt,
  })

  const decodedActions = await decodeCalls([call], deps.lookups)
  const verdict = verifyPlan({ intent, calls: [call], decodedActions })
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
    warnings,
    expiresAt: record.plan.expiresAt,
    reviewUrl: link.url,
    linkExpiresAt: link.expiresAt,
  }
}

/** The words the agent reads out. The structured copy carries the same facts. */
export function prepareText(outcome: PrepareOutcome): string {
  switch (outcome.kind) {
    case 'invalid':
      return `That is not a transfer Ottopus can build:\n${outcome.reasons.map((r) => `- ${r}`).join('\n')}`
    case 'no_wallet':
      return `No linked wallet can make this transfer:\n${outcome.reasons.map((r) => `- ${r}`).join('\n')}`
    case 'blocked':
      return [
        `Ottopus refused to build "${outcome.summary}":`,
        ...outcome.reasons.map((r) => `- ${r}`),
        'The refusal is recorded in Activity. Nothing was sent.',
      ].join('\n')
    case 'ready':
      return [
        `Plan ready: ${outcome.summary}.`,
        outcome.reason,
        ...outcome.warnings.map((w) => `Heads up: ${w.message}`),
        `Review and sign: ${outcome.reviewUrl}`,
        `The link is good for a few minutes and the plan expires at ${outcome.expiresAt}. Nothing moves until the person signs in their own wallet.`,
      ].join('\n')
  }
}
