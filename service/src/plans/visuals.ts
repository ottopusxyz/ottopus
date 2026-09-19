import type { Portfolio } from '../connectors/portfolio/index.js'
import type { TokenRegistry } from '../connectors/tokens/index.js'
import type { Plan } from '../core/index.js'
import { findChain, nativeAssetIdOf } from '../core/index.js'
import type { Arm } from '../wallets/index.js'
import type { PlanSummary } from './store.js'

/**
 * What the review page draws beside the plan: token icons, chain icons, and
 * which wallet client an account lives in. Looked up at read time by the ids
 * the plan already carries, and handed back beside the plan — never inside
 * it. The plan is hashed; a logo URL from a provider's CDN is not something a
 * hash should bind, and a missing one must never make a plan unreadable.
 */
export interface Visuals {
  /** `priceUsd` is today's, from whoever knew the asset; null when nobody prices it. */
  assets: Record<string, { symbol: string; name: string; iconUrl: string | null; priceUsd: number | null }>
  chains: Record<string, ChainVisual>
  wallets: Record<string, { walletType: string; label: string | null }>
}

/**
 * A chain's words, plus the CAIP-19 id of its own currency.
 *
 * The native asset id is here because the review page needs it and must not
 * work it out: the SLIP-44 table lives in core, and a page that guessed coin
 * type 60 would label BNB as ETH. The page simulates in the browser and gets
 * bare addresses back; this is how it names the native row without owning the
 * table.
 */
export interface ChainVisual {
  name: string
  iconUrl: string | null
  /** e.g. eip155:8453/slip44:60. Null on a chain whose currency core cannot name. */
  nativeAssetId: string | null
  nativeSymbol: string
  nativeDecimals: number
}

/** Every asset id a plan mentions. */
function assetIdsOf(plan: Plan): string[] {
  const ids = new Set<string>()
  if (plan.intent.kind === 'transfer') ids.add(plan.intent.asset)
  // Both sides of a trade. The receiving side is the one that needed a
  // registry, and the one the person is deciding about.
  if (plan.intent.kind === 'swap' || plan.intent.kind === 'bridge') {
    ids.add(plan.intent.from)
    ids.add(plan.intent.to)
  }
  // Everything the agent declared may leave. What arrives is only known
  // once a simulation has run, and those ids are picked up below.
  if (plan.intent.kind === 'custom') {
    for (const c of plan.intent.expectedChanges) ids.add(c.asset)
    for (const a of plan.intent.approvals) ids.add(a.asset)
  }
  for (const a of plan.humanPlan.assets ?? []) ids.add(a.id)
  // A simulation can name assets the intent never did — a swap's output, a
  // token a call moved on the side. Those rows are on the page, so their
  // icons have to be looked up too.
  for (const change of plan.simulation?.assetChanges ?? []) ids.add(change.assetId)
  return [...ids]
}

/** Every account a plan names: the signer and the alternatives it retained. */
function accountsOf(plan: Plan): string[] {
  return [plan.resolution.account.caip10, ...plan.resolution.candidatesConsidered.map((c) => c.account)]
}

export async function visualsFor(
  plan: Plan,
  arms: readonly Arm[],
  portfolio: Portfolio | null,
  tokens: TokenRegistry | null = null,
): Promise<Visuals> {
  const visuals: Visuals = { assets: {}, chains: {}, wallets: {} }

  /**
   * The portfolio first, then the token registry.
   *
   * A trade's receiving side is not in the portfolio by definition — nobody
   * holds it yet — so on a swap the icon and the name were simply missing
   * from the one row the person is deciding about. The registry is the only
   * source for it. A lookup that fails costs an icon and nothing else.
   */
  await Promise.all(
    assetIdsOf(plan).map(async (id) => {
      const row = portfolio?.assets.find((a) => a.assetId.toLowerCase() === id.toLowerCase())
      if (row) {
        visuals.assets[id] = { symbol: row.asset.symbol, name: row.asset.name, iconUrl: row.asset.iconUrl, priceUsd: row.price }
        return
      }
      const known = await tokens?.byAssetId(id)
      if (known) visuals.assets[id] = { symbol: known.symbol, name: known.name, iconUrl: known.iconUrl, priceUsd: known.priceUsd }
    }),
  )

  const [namespace, reference] = plan.resolution.account.caip10.split(':')
  const chainId = `${namespace}:${reference}`
  const chain = portfolio?.chains.find((c) => c.chainId.toLowerCase() === chainId.toLowerCase())
  const info = findChain(chainId)
  if (chain || info) {
    visuals.chains[chainId] = {
      name: chain?.name ?? info?.name ?? chainId,
      iconUrl: chain?.iconUrl ?? null,
      nativeAssetId: nativeAssetIdOf(chainId),
      nativeSymbol: info?.nativeCurrency.symbol ?? 'units',
      nativeDecimals: info?.nativeCurrency.decimals ?? 18,
    }
  }

  for (const account of accountsOf(plan)) {
    const address = account.split(':')[2]?.toLowerCase()
    const arm = arms.find((a) => a.address.toLowerCase() === address)
    if (arm) visuals.wallets[account] = { walletType: arm.walletType, label: arm.label }
  }

  return visuals
}

/** A list row with what the portfolio and the wallets table know beside it. */
export interface DecoratedSummary extends PlanSummary {
  assetIconUrl: string | null
  chainIconUrl: string | null
  /** The asset's value in USD at today's price, when the portfolio prices it. */
  valueUsd: number | null
  wallet: { walletType: string; label: string | null } | null
}

export function decorateSummary(row: PlanSummary, arms: readonly Arm[], portfolio: Portfolio | null): DecoratedSummary {
  const held = row.asset ? portfolio?.assets.find((a) => a.assetId.toLowerCase() === row.asset!.id.toLowerCase()) : undefined
  const chain = portfolio?.chains.find((c) => c.chainId.toLowerCase() === row.chainId.toLowerCase())
  const address = row.account.caip10.split(':')[2]?.toLowerCase()
  const arm = arms.find((a) => a.address.toLowerCase() === address)
  let valueUsd: number | null = null
  if (row.asset && held?.price !== null && held?.price !== undefined) {
    const decimals = row.asset.decimals ?? held.asset.decimals
    valueUsd = (Number(row.asset.amount) / 10 ** decimals) * held.price
  }
  return {
    ...row,
    asset: row.asset && held ? { ...row.asset, symbol: row.asset.symbol ?? held.asset.symbol, decimals: row.asset.decimals ?? held.asset.decimals } : row.asset,
    assetIconUrl: held?.asset.iconUrl ?? null,
    chainIconUrl: chain?.iconUrl ?? null,
    valueUsd,
    wallet: arm ? { walletType: arm.walletType, label: arm.label } : null,
  }
}
