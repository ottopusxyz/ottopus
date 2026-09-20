import type { AssetRow, ChainRow } from '@/lib/api'

/**
 * What the nudge asks a person to try. A stock on chain first, then the
 * design's three, then two for the custom tier — the same shapes the demo
 * runs. Concrete on purpose: "try something" is not a prompt, "swap 20 USDC
 * for ETH on Base" is. "Buy me NVIDIA" leads because it says what an agent
 * with every wallet can do that a swap box cannot: find the token, pick the
 * chain it lives on, and route to it.
 */
export const INTENT_PROMPTS: readonly string[] = [
  'Buy me NVIDIA token using 10 USDC',
  'Swap 20 USDC for ETH on Base',
  'Move my idle USDC to the cheapest chain',
  'Show me every unlimited approval I have',
  'Add liquidity to the USDC/ETH pool on Base',
  'Bridge 50 USDC to Arbitrum',
]

const STABLES = new Set(['USDC', 'USDT', 'DAI', 'USDBC', 'USDE', 'USDS'])

/**
 * A small slice of a holding, to two significant figures, so the prompt asks
 * for an amount the wallet can actually spend and the number reads like one a
 * person would type. Null when the holding is dust.
 */
export function smallSlice(amount: string, decimals: number, fraction = 0.05): string | null {
  if (!/^[0-9]+$/.test(amount)) return null
  const held = Number(amount) / 10 ** decimals
  const slice = held * fraction
  // Under a ten-thousandth the prompt would read like a typo; that is dust.
  if (!(slice >= 0.0001) || !Number.isFinite(slice)) return null
  const digits = Math.floor(Math.log10(slice))
  const unit = 10 ** (digits - 1)
  const rounded = Math.round(slice / unit) * unit
  if (rounded <= 0) return null
  return rounded.toLocaleString('en-US', { maximumFractionDigits: Math.max(0, 1 - digits), useGrouping: false })
}

/**
 * The prompts, with one about what the person actually holds in second place.
 *
 * The largest loose balance is the one an agent can most plausibly move, and
 * a prompt naming it turns "try me" into "try me with this". A stable becomes
 * a swap into ETH at a round figure; anything else becomes a small slice of
 * itself into USDC. It goes second rather than first so the lead prompt is
 * the same for everyone. Without a reading, or with nothing spendable, the
 * fixed list stands.
 */
export function promptsFor(portfolio: { assets: readonly AssetRow[]; chains: readonly ChainRow[] } | null): readonly string[] {
  const top = portfolio?.assets.filter((row) => row.value > 0).sort((a, b) => b.value - a.value)[0]
  if (!top) return INTENT_PROMPTS
  const chain = portfolio!.chains.find((c) => c.chainId === top.chainId)?.name
  if (!chain) return INTENT_PROMPTS
  const symbol = top.asset.symbol.toUpperCase()
  const lead = STABLES.has(symbol)
    ? `Swap 20 ${top.asset.symbol} for ETH on ${chain}`
    : (() => {
        const slice = smallSlice(top.amount, top.asset.decimals)
        return slice ? `Swap ${slice} ${top.asset.symbol} for USDC on ${chain}` : null
      })()
  if (!lead) return INTENT_PROMPTS
  const [first, ...rest] = INTENT_PROMPTS
  return [first!, lead, ...rest.filter((p) => p !== lead)]
}
