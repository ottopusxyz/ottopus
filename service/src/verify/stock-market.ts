import type { StockInfo } from '../connectors/tokens/types.js'
import type { PlanStock, StockMarketState } from '../core/index.js'
import { nyseSession } from './market-calendar.js'

/**
 * The market's state and where the reading came from. The same shape the
 * plan stores under `humanPlan.stocks[].market`, so what verify judged and
 * what the page shows are one object.
 */
export type StockMarket = PlanStock['market']

/**
 * Whether the vendor's reason for `open: false` reads as a halt rather than
 * a closed session. The vendor names halts (`TRADING_HALT`,
 * `CORPORATE_ACTION`) and session breaks (`MARKET_PAUSED`, `MARKET_CLOSED`)
 * in its reason code; a close with no code at all is a close, because a halt
 * is the thing worth a name. The stem `suspen` covers both `SUSPENDED` and
 * `SUSPENSION`, which `suspend` would not.
 */
export function stockHalted(info: StockInfo): boolean {
  const { open, reason } = info.stock.status
  return !open && /halt|suspen|corporate/i.test(reason ?? '')
}

/**
 * The vendor's session word as one of ours, or null when it is not a
 * session this module knows. Spelling varies by issuer (`pre_market`,
 * `premarket`, `after-hours`, `post_market`), so the comparison drops the
 * punctuation before it looks.
 */
export function sessionOf(word: string | null): Exclude<StockMarketState, 'closed' | 'halted'> | null {
  const plain = word?.toLowerCase().replace(/[\s_-]/g, '') ?? ''
  if (plain === 'regular' || plain === 'regularhours' || plain === 'rth') return 'regular'
  if (plain === 'premarket' || plain === 'pre') return 'premarket'
  if (plain === 'afterhours' || plain === 'aftermarket' || plain === 'postmarket' || plain === 'post') return 'afterhours'
  if (plain === 'overnight') return 'overnight'
  return null
}

/**
 * The market's state for a stock side, and where the reading came from.
 *
 * Precedence, in the order the reasons matter: a halt is the vendor's word
 * and nobody else's; so is "not open", whatever the calendar thinks, since
 * a token the vendor has paused does not trade because it is 11:00 in New
 * York. Past those, the vendor's session word when it gives one. Only when
 * it says open and no more does the calendar label the hour, and if the
 * calendar says the exchange is closed, the reading is `closed`: the
 * vendor's flag still says the token trades, but a reference price on a
 * Saturday cannot be live, and the review page should say so. The
 * calendar's bells fill in the next open and close only where the vendor
 * left them blank.
 */
export function stockMarket(info: StockInfo, now: Date): StockMarket {
  const { status } = info.stock
  const base = {
    session: status.marketStatus,
    reason: status.reason,
    note: status.reasonMessage ?? null,
    nextOpenAt: status.nextOpenAt,
    nextCloseAt: status.nextCloseAt,
  }
  if (stockHalted(info)) return { state: 'halted', source: 'vendor', ...base }
  if (!status.open) return { state: 'closed', source: 'vendor', ...base }
  const named = sessionOf(status.marketStatus)
  if (named) return { state: named, source: 'vendor', ...base }
  const calendar = nyseSession(now)
  return {
    state: calendar.session,
    source: 'calendar',
    ...base,
    nextOpenAt: status.nextOpenAt ?? calendar.nextOpenAt,
    nextCloseAt: status.nextCloseAt ?? calendar.nextCloseAt,
  }
}

/** The state as a person says it: "pre-market", "after-hours", "regular hours". */
export function stockMarketWords(state: StockMarketState): string {
  switch (state) {
    case 'regular':
      return 'regular hours'
    case 'premarket':
      return 'pre-market'
    case 'afterhours':
      return 'after-hours'
    case 'overnight':
      return 'overnight'
    case 'closed':
      return 'closed'
    case 'halted':
      return 'halted'
  }
}
