import type { Portfolio, ProtocolPositionType } from '../connectors/portfolio/index.js'
import type { Arm } from '../wallets/index.js'

/**
 * Tool answers in words.
 *
 * An agent reads tool output as text before it reads it as data, and a person
 * reads it after the agent repeats it. Both are better served by "Main — Rabby,
 * 0xd8da…6045, can sign" than by a row with eight snake_case keys. The
 * structured copy rides alongside for the agent that wants to compute; the
 * sentence is what gets quoted back to the person.
 */

export function truncateAddress(address: string): string {
  return address.length > 13 ? `${address.slice(0, 6)}…${address.slice(-4)}` : address
}

/** What to call a wallet: the label someone gave it, else the software it is. */
export function walletName(arm: Pick<Arm, 'label' | 'walletType'>): string {
  if (arm.label) return arm.label
  return arm.walletType
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((word) => word[0]!.toUpperCase() + word.slice(1))
    .join(' ')
}

/** The chain family a namespace stands for, in the words a person uses. */
export function namespaceLabel(namespace: string): string {
  switch (namespace) {
    case 'eip155':
      return 'Ethereum and every EVM chain'
    case 'solana':
      return 'Solana'
    case 'bip122':
      return 'Bitcoin'
    default:
      return namespace
  }
}

/**
 * Whether Otto can ask this wallet to sign. Watch-only arms never can; a
 * connected one can only once its ownership was proved.
 */
export function canSign(arm: Pick<Arm, 'isWatchOnly' | 'provedAt'>): boolean {
  return !arm.isWatchOnly && arm.provedAt !== null
}

/**
 * A wallet's name where several may appear side by side. A label is unique
 * enough on its own; a fallback like "Watch Only" is not — two pasted
 * addresses would both be called that — so the fallback carries the address.
 */
export function holderName(arm: Pick<Arm, 'label' | 'walletType' | 'address'>): string {
  return arm.label ? arm.label : `${walletName(arm)} ${truncateAddress(arm.address)}`
}

export function describeWallet(arm: Arm): string {
  const signing = arm.isWatchOnly
    ? 'watch only, cannot sign'
    : canSign(arm)
      ? 'can sign'
      : 'not yet proved, cannot sign'
  return `${walletName(arm)} — ${arm.walletType}, ${truncateAddress(arm.address)}, ${signing}`
}

export function walletsText(arms: readonly Arm[]): string {
  if (arms.length === 0) return 'No wallets are linked yet. Ottopus can only plan with a linked wallet.'
  const n = arms.length
  const lines = arms.map((arm, i) => `${i + 1}. ${describeWallet(arm)}`)
  return [`${n} wallet${n === 1 ? '' : 's'} linked:`, ...lines].join('\n')
}

/**
 * Base units to a human amount. BigInt throughout: 10^18 is past what a double
 * holds exactly, and a balance rounded on the way to an agent is a balance the
 * agent will quote wrong.
 *
 * Four fraction digits at most, trailing zeros dropped, and anything that
 * rounds to nothing shows as "<0.0001" rather than "0" — a zero here reads as
 * "you have none", which is not what a dust balance means.
 */
export function humanAmount(amount: string, decimals: number, fraction = 4): string {
  let units: bigint
  try {
    units = BigInt(amount)
  } catch {
    return amount
  }
  const negative = units < 0n
  if (negative) units = -units
  const base = 10n ** BigInt(decimals)
  const whole = units / base
  const rest = units % base
  const wholeText = whole.toLocaleString('en-US')

  if (decimals === 0 || rest === 0n) return `${negative ? '-' : ''}${wholeText}`

  const keep = Math.min(fraction, decimals)
  const scaled = (rest * 10n ** BigInt(keep)) / base
  const sign = negative ? '-' : ''
  if (scaled === 0n) {
    // Dust: something is there, and "0" would say otherwise.
    return whole === 0n ? `${sign}<0.${'0'.repeat(keep - 1)}1` : `${sign}${wholeText}`
  }
  const fractionText = scaled.toString().padStart(keep, '0').replace(/0+$/, '')
  return `${sign}${wholeText}.${fractionText}`
}

const money = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

export function usd(value: number): string {
  return money.format(value)
}

/** "+$12.40 today" / "−$8.26 today" / "no change today". */
export function changeText(change: number): string {
  if (Math.abs(change) < 0.005) return 'no change today'
  return `${change > 0 ? '+' : '−'}${usd(Math.abs(change))} today`
}

export interface PortfolioSummary {
  currency: 'usd'
  total: number
  change1d: number
  asOf: string
  provider: string
  wallets: {
    id: string
    name: string
    address: string
    status: string
    total: number
  }[]
  /**
   * Loose balances only — every amount here is one a wallet could send today.
   * What is deposited, staked or borrowed is under `protocols`, never here.
   */
  assets: {
    symbol: string
    name: string
    chain: string
    amount: string
    value: number
    /**
     * Which wallets hold it, and how much each. The row above is the sum; this
     * is what an agent needs to answer "which of my wallets has USDC on Base"
     * before it asks for a transfer from one of them.
     */
    wallets: { id: string; name: string; amount: string }[]
  }[]
  /** Rows past the limit, so the agent knows the list is cut. */
  omitted: number
  /**
   * One entry per app, each with the positions the app itself groups
   * together — a lending market with its collateral and its debt. Values are
   * net; each position says in words how it is held, so "borrowed" is never
   * mistaken for "held".
   */
  protocols: {
    id: string
    name: string
    /** Net across every position: deposits less debt. A floor when `unpriced` is above zero. */
    value: number
    /** Holdings with no price, left out of `value`. */
    unpriced: number
    positions: {
      name: string
      chain: string
      /** Net for this group, with any unpriced holding counted as nothing. */
      value: number
      unpriced: number
      holdings: {
        symbol: string
        amount: string
        /** deposited, borrowed, staked, locked, claimable, invested. */
        held: string
        value: number | null
        wallet: { id: string; name: string }
      }[]
    }[]
  }[]
}

/** How a protocol position is held, as a person says it. */
export function heldWord(positionType: ProtocolPositionType): string {
  switch (positionType) {
    case 'deposit':
      return 'deposited'
    case 'loan':
      return 'borrowed'
    case 'staked':
      return 'staked'
    case 'locked':
      return 'locked'
    case 'reward':
      return 'claimable'
    case 'investment':
      return 'invested'
  }
}

/**
 * The portfolio as an agent should see it: the total, each wallet, and the
 * assets that matter, highest value first. Capped, because a real account
 * carries hundreds of dust rows and an agent quoting "your 47 assets" back to
 * someone is worse than one quoting the six that hold the money.
 */
export function summarisePortfolio(
  portfolio: Portfolio,
  arms: readonly Arm[],
  limit: number,
): PortfolioSummary {
  const byId = new Map(arms.map((arm) => [arm.id, arm]))
  const chains = new Map(portfolio.chains.map((chain) => [chain.chainId, chain.name]))
  const sorted = [...portfolio.assets].sort((a, b) => b.value - a.value)
  const shown = sorted.slice(0, limit)
  const nameOf = (id: string) => {
    const known = byId.get(id)
    return known ? holderName(known) : truncateAddress(id)
  }

  return {
    currency: portfolio.currency,
    total: portfolio.total,
    change1d: portfolio.change1d,
    asOf: portfolio.asOf,
    provider: portfolio.provider,
    wallets: portfolio.arms.map((arm) => {
      const known = byId.get(arm.walletId)
      return {
        id: arm.walletId,
        name: known ? walletName(known) : truncateAddress(arm.address),
        address: arm.address,
        status: arm.status,
        total: arm.total,
      }
    }),
    assets: shown.map((row) => ({
      symbol: row.asset.symbol,
      name: row.asset.name,
      chain: chains.get(row.chainId) ?? row.chainId,
      amount: humanAmount(row.amount, row.asset.decimals),
      value: row.value,
      wallets: holdersOf(row.holdings, row.asset.decimals, nameOf),
    })),
    omitted: Math.max(0, sorted.length - shown.length),
    // Not capped: an account with more protocol groups than the limit is rare,
    // and the debt row an agent most needs is often the smallest by value.
    protocols: portfolio.protocols.map((app) => ({
      id: app.id,
      name: app.name,
      value: app.value,
      unpriced: app.unpriced,
      positions: app.groups.map((group) => ({
        name: group.name,
        chain: chains.get(group.chainId) ?? group.chainId,
        value: group.value,
        unpriced: group.unpriced,
        holdings: group.holdings.map((holding) => ({
          symbol: holding.asset.symbol,
          amount: humanAmount(holding.amount, holding.asset.decimals),
          held: heldWord(holding.positionType),
          value: holding.value,
          wallet: { id: holding.walletId, name: nameOf(holding.walletId) },
        })),
      })),
    })),
  }
}

/**
 * One entry per wallet holding an asset, amounts summed across arms. Only
 * loose balances reach here, so what a wallet holds is what it could send.
 */
export function holdersOf(
  holdings: readonly { walletId: string; amount: string }[],
  decimals: number,
  nameOf: (walletId: string) => string,
): { id: string; name: string; amount: string }[] {
  const sums = new Map<string, bigint>()
  for (const holding of holdings) {
    let units = 0n
    try {
      units = BigInt(holding.amount)
    } catch {
      continue
    }
    sums.set(holding.walletId, (sums.get(holding.walletId) ?? 0n) + units)
  }
  return [...sums]
    .sort((a, b) => (b[1] > a[1] ? 1 : b[1] < a[1] ? -1 : 0))
    .map(([id, units]) => ({ id, name: nameOf(id), amount: humanAmount(units.toString(), decimals) }))
}

/** "in Main" for one wallet, "across 2 wallets" for more, nothing for none. */
export function heldByText(wallets: readonly { name: string }[]): string {
  if (wallets.length === 0) return ''
  if (wallets.length === 1) return ` in ${wallets[0]!.name}`
  return ` across ${wallets.length} wallets`
}

export function portfolioText(summary: PortfolioSummary): string {
  const n = summary.wallets.length
  const head = `Total ${usd(summary.total)} across ${n} wallet${n === 1 ? '' : 's'}, ${changeText(summary.change1d)}.`

  const unread = summary.wallets.filter((wallet) => wallet.status !== 'ok')
  const caveat =
    unread.length > 0
      ? `${unread.length} of ${n} could not be read (${unread.map((w) => w.name).join(', ')}) and are left out of the total.`
      : null

  const assets =
    summary.assets.length === 0
      ? summary.protocols.length === 0
        ? 'No balances found.'
        : 'Nothing loose in any wallet.'
      : [
          'In wallets, highest value first:',
          ...summary.assets.map(
            (row) =>
              `- ${row.amount} ${row.symbol} on ${row.chain}${heldByText(row.wallets)} — ${usd(row.value)}`,
          ),
          ...(summary.omitted > 0 ? [`…and ${summary.omitted} smaller.`] : []),
        ].join('\n')

  // One line per group, every holding in words: "1.2398 ETH deposited, 1,202
  // USDC borrowed". The net closes the line so a debt is never read as a gain.
  const protocols =
    summary.protocols.length === 0
      ? null
      : [
          'In protocols:',
          ...summary.protocols.flatMap((app) =>
            app.positions.map((group) => {
              const parts = group.holdings.map(
                (h) => `${h.amount} ${h.symbol} ${h.held}${h.value === null ? ' (no price)' : ` (${usd(h.value)})`} in ${h.wallet.name}`,
              )
              // A net with an unpriced holding in it is not a net. Say what is
              // known and that something is not, rather than a figure that reads
              // as the whole.
              const net = group.unpriced > 0
                ? `priced part ${usd(group.value)}, ${group.unpriced} holding${group.unpriced === 1 ? '' : 's'} unpriced`
                : `net ${usd(group.value)}`
              return `- ${app.name} — ${group.name} on ${group.chain}: ${parts.join(', ')}; ${net}`
            }),
          ),
        ].join('\n')

  return [head, caveat, assets, protocols].filter(Boolean).join('\n')
}
