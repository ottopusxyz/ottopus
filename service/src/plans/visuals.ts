import type { Portfolio } from '../connectors/portfolio/index.js'
import type { Plan } from '../core/index.js'
import type { Arm } from '../wallets/index.js'

/**
 * What the review page draws beside the plan: token icons, chain icons, and
 * which wallet client an account lives in. Looked up at read time by the ids
 * the plan already carries, and handed back beside the plan — never inside
 * it. The plan is hashed; a logo URL from a provider's CDN is not something a
 * hash should bind, and a missing one must never make a plan unreadable.
 */
export interface Visuals {
  assets: Record<string, { symbol: string; name: string; iconUrl: string | null }>
  chains: Record<string, { name: string; iconUrl: string | null }>
  wallets: Record<string, { walletType: string; label: string | null }>
}

/** Every asset id a plan mentions. */
function assetIdsOf(plan: Plan): string[] {
  const ids = new Set<string>()
  if (plan.intent.kind === 'transfer') ids.add(plan.intent.asset)
  for (const a of plan.humanPlan.assets ?? []) ids.add(a.id)
  return [...ids]
}

/** Every account a plan names: the signer and the alternatives it retained. */
function accountsOf(plan: Plan): string[] {
  return [plan.resolution.account.caip10, ...plan.resolution.candidatesConsidered.map((c) => c.account)]
}

export function visualsFor(plan: Plan, arms: readonly Arm[], portfolio: Portfolio | null): Visuals {
  const visuals: Visuals = { assets: {}, chains: {}, wallets: {} }

  for (const id of assetIdsOf(plan)) {
    const row = portfolio?.assets.find((a) => a.assetId.toLowerCase() === id.toLowerCase())
    if (row) visuals.assets[id] = { symbol: row.asset.symbol, name: row.asset.name, iconUrl: row.asset.iconUrl }
  }

  const [namespace, reference] = plan.resolution.account.caip10.split(':')
  const chainId = `${namespace}:${reference}`
  const chain = portfolio?.chains.find((c) => c.chainId.toLowerCase() === chainId.toLowerCase())
  if (chain) visuals.chains[chainId] = { name: chain.name, iconUrl: chain.iconUrl ?? null }

  for (const account of accountsOf(plan)) {
    const address = account.split(':')[2]?.toLowerCase()
    const arm = arms.find((a) => a.address.toLowerCase() === address)
    if (arm) visuals.wallets[account] = { walletType: arm.walletType, label: arm.label }
  }

  return visuals
}
