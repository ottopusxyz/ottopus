import type { AssetRow } from '@/lib/api'

export interface TokenGroup {
  id: string
  asset: AssetRow['asset']
  amount: string
  spendable: string
  value: number
  share: number
  priced: boolean
  networks: { chainId: string; amount: string; spendable: string; value: number; priced: boolean }[]
  /** Every arm's share, with the chain it sits on — the breakdown lists them per network. */
  holdings: (AssetRow['holdings'][number] & { chainId: string })[]
}

/** UI aggregation only: executable positions retain their chain-specific CAIP IDs. */
export function groupTokens(rows: readonly AssetRow[]): TokenGroup[] {
  const families = new Map<string, AssetRow[]>()
  for (const row of rows) {
    // Never group by symbol: an unrelated token can use any ticker it likes.
    const key = row.asset.familyId ? `family:${row.asset.familyId}` : `asset:${row.assetId}`
    const members = families.get(key) ?? []
    members.push(row)
    families.set(key, members)
  }
  return [...families].map(([id, members]) => {
    const decimals = Math.max(...members.map((row) => row.asset.decimals))
    const amountOf = (row: AssetRow, field: 'amount' | 'spendable') =>
      BigInt(row[field]) * 10n ** BigInt(decimals - row.asset.decimals)
    const sum = (items: AssetRow[], field: 'amount' | 'spendable') =>
      items.reduce((value, row) => value + amountOf(row, field), 0n).toString()
    const priced = (items: AssetRow[]) => items.some((row) => row.holdings.some((h) => h.value !== null))
    const networkIds = [...new Set(members.map((row) => row.chainId))]
    return {
      id,
      asset: {
        ...members[0]!.asset, decimals,
        iconUrl: members.find((row) => row.asset.iconUrl)?.asset.iconUrl ?? null,
        verified: members.every((row) => row.asset.verified),
      },
      amount: sum(members, 'amount'), spendable: sum(members, 'spendable'),
      value: members.reduce((value, row) => value + row.value, 0),
      share: members.reduce((value, row) => value + row.share, 0),
      priced: priced(members),
      holdings: members.flatMap((row) => row.holdings.map((holding) => ({
        ...holding, chainId: row.chainId,
        amount: (BigInt(holding.amount) * 10n ** BigInt(decimals - row.asset.decimals)).toString(),
      }))),
      networks: networkIds.map((chainId) => {
        const items = members.filter((row) => row.chainId === chainId)
        return {
          chainId, amount: sum(items, 'amount'), spendable: sum(items, 'spendable'),
          value: items.reduce((value, row) => value + row.value, 0), priced: priced(items),
        }
      }).sort((a, b) => b.value - a.value),
    }
  }).sort((a, b) => b.value - a.value)
}

/** Truncate with integer arithmetic; exact balances are available in the detail popover. */
export function compactBalance(amount: string, decimals: number): string {
  const units = BigInt(amount)
  const scale = 10n ** BigInt(decimals)
  for (const [power, suffix] of [[12, 'T'], [9, 'B'], [6, 'M'], [3, 'K']] as const) {
    const divisor = scale * 10n ** BigInt(power)
    if (units < divisor) continue
    const hundredths = units * 100n / divisor
    const whole = hundredths / 100n
    if (whole >= 1000n) return '>999T'
    const fraction = (hundredths % 100n).toString().padStart(2, '0').replace(/0+$/, '')
    return `${whole}${fraction ? `.${fraction}` : ''}${suffix}`
  }
  return ''
}
