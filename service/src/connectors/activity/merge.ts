/**
 * Every arm's history, folded into one feed, newest first, a page at a time.
 *
 * Eight arms are eight streams that each come sorted. Merging one page of
 * each is not enough on its own: the oldest row on a stream's page is older
 * than rows that stream has not shown yet, so nothing below that point can
 * be emitted from *any* stream without risking a row that should have come
 * first. The watermark is the newest of those per-stream oldest rows; what
 * lies at or above it is safe to show, the rest waits for the next page.
 *
 * The cursor is a bound per arm — the instant of the last row shown from it,
 * plus the ids shown in that same second — rather than the provider's own
 * page token. The provider's bound is a documented filter and the token is
 * not, and this way the client can hold the cursor as an opaque string with
 * nothing in it that could be replayed against another account.
 */

import type { ArmRef } from '../portfolio/aggregate.js'
import { PortfolioError } from '../portfolio/types.js'
import type { ArmStatus } from '../portfolio/aggregate.js'
import type { Activity, ActivityConnector, ActivityKind } from './types.js'

/** An activity, and the arm it was read for. The same transaction between two arms appears twice. */
export interface ActivityRow extends Activity {
  walletId: string
}

export interface ActivityArm {
  walletId: string
  address: string
  status: ArmStatus
}

export interface ActivityChain {
  chainId: string
  name: string
  iconUrl: string | null
}

export interface ActivityFeed {
  provider: string
  items: ActivityRow[]
  /** Pass back to read the next page. Null when every arm is exhausted. */
  cursor: string | null
  arms: ActivityArm[]
  /** The chains the rows on this page are on, for a filter to offer. */
  chains: ActivityChain[]
}

export interface ActivityFeedQuery {
  kinds?: readonly ActivityKind[] | undefined
  chainId?: string | undefined
  cursor?: string | null | undefined
  size: number
}

/**
 * Where one arm's stream stands: the last row shown; exhausted; or skipped
 * for the rest of this feed because a read failed. A failed arm cannot
 * rejoin a feed that has moved on without its rows landing under older
 * ones, so it sits out until the page is read again from the top.
 */
type ArmMark = { before: string; seen: string[] } | 'done' | { skip: ArmStatus }

/**
 * How many ids a bound remembers for its second. A second holding more
 * rows than this is jumped rather than remembered — the cursor has to fit
 * a query string, and no wallet mines that many in one second.
 */
export const MAX_SEEN = 20

interface Cursor {
  v: 1
  arms: Record<string, ArmMark>
}

export function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString('base64url')
}

/** Null for anything that is not a cursor this module wrote. */
export function decodeCursor(raw: string): Cursor | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'))
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object') return null
  const { v, arms } = parsed as { v?: unknown; arms?: unknown }
  if (v !== 1 || !arms || typeof arms !== 'object') return null
  const out: Record<string, ArmMark> = {}
  for (const [walletId, mark] of Object.entries(arms as Record<string, unknown>)) {
    if (mark === 'done') {
      out[walletId] = 'done'
      continue
    }
    if (!mark || typeof mark !== 'object') return null
    const { before, seen, skip } = mark as { before?: unknown; seen?: unknown; skip?: unknown }
    if (typeof skip === 'string') {
      if (!ARM_STATUSES.has(skip)) return null
      out[walletId] = { skip: skip as ArmStatus }
      continue
    }
    if (typeof before !== 'string' || !Number.isFinite(Date.parse(before))) return null
    if (!Array.isArray(seen) || seen.length > MAX_SEEN || !seen.every((id) => typeof id === 'string')) return null
    out[walletId] = { before, seen }
  }
  return { v: 1, arms: out }
}

const ARM_STATUSES = new Set<string>(['ok', 'untracked_address', 'rate_limited', 'unavailable', 'not_configured'])

interface ArmRead {
  arm: ArmRef
  mark: ArmMark | null
  items: ActivityRow[]
  more: boolean
  status: ArmStatus
  /** Every row the provider returned, kept or not. */
  raw: { id: string; minedAt: string }[]
}

/** One second earlier, for a bound that has to jump a second it cannot remember. */
function secondBefore(at: string): string {
  return new Date(Date.parse(at) - 1000).toISOString().replace('.000Z', 'Z')
}

/**
 * Where an arm's bound goes when the page it read had nothing new on it —
 * every row already shown, or dropped for a chain we cannot name. Left
 * alone, the same page comes back forever.
 */
function advance(mark: ArmMark | null, raw: { id: string; minedAt: string }[]): ArmMark | null {
  const last = raw.at(-1)
  if (!last) return mark
  const stuck = mark && typeof mark === 'object' && 'before' in mark && mark.before === last.minedAt
  const ids = raw.filter((row) => row.minedAt === last.minedAt).map((row) => row.id)
  if (stuck || ids.length > MAX_SEEN) return { before: secondBefore(last.minedAt), seen: [] }
  return { before: last.minedAt, seen: ids }
}

function statusOf(error: unknown): ArmStatus {
  return error instanceof PortfolioError ? error.code : 'unavailable'
}

/** Newest first; ties broken so the order is the same on every read. */
function byNewest(a: ActivityRow, b: ActivityRow): number {
  const at = Date.parse(b.minedAt) - Date.parse(a.minedAt)
  if (at !== 0) return at
  return a.walletId === b.walletId ? a.id.localeCompare(b.id) : a.walletId.localeCompare(b.walletId)
}

/**
 * One page of the merged feed.
 *
 * A cursor naming an arm that is no longer linked is ignored for that arm;
 * an arm the cursor does not name starts from the top. Both are what a list
 * that changed underneath a page should do.
 */
export async function readActivity(
  connector: ActivityConnector,
  arms: readonly ArmRef[],
  query: ActivityFeedQuery,
): Promise<ActivityFeed> {
  const cursor = query.cursor ? decodeCursor(query.cursor) : null
  if (query.cursor && !cursor) throw new PortfolioError('unavailable', 'activity cursor is not one we wrote')

  const reads: ArmRead[] = await Promise.all(
    arms.map(async (arm): Promise<ArmRead> => {
      const mark = cursor?.arms[arm.walletId] ?? null
      if (mark === 'done') return { arm, mark, items: [], more: false, status: 'ok', raw: [] }
      if (mark && 'skip' in mark) return { arm, mark, items: [], more: false, status: mark.skip, raw: [] }
      try {
        const seen = new Set(mark?.seen ?? [])
        // The rows already shown come back at the top of a page bounded at
        // their second, and are dropped below — so ask for that many more, or
        // a busy second would eat the page and the feed would stand still.
        const page = await connector.transactionsFor(arm, {
          kinds: query.kinds,
          chainId: query.chainId,
          before: mark?.before,
          size: query.size + seen.size,
        })
        const items = page.items
          .filter((item) => !seen.has(item.id))
          .map((item) => ({ ...item, walletId: arm.walletId }))
        return { arm, mark, items, more: page.more, status: 'ok', raw: page.raw }
      } catch (err) {
        return { arm, mark, items: [], more: false, status: statusOf(err), raw: [] }
      }
    }),
  )

  // Nothing older than this can be shown yet: an arm with more pages may
  // still hold rows newer than it.
  let watermark = -Infinity
  for (const read of reads) {
    const last = read.items.at(-1)
    if (read.more && last) watermark = Math.max(watermark, Date.parse(last.minedAt))
  }

  const merged = reads.flatMap((read) => read.items).sort(byNewest)
  const items = merged.filter((item) => Date.parse(item.minedAt) >= watermark).slice(0, query.size)
  const shown = new Set(items.map((item) => `${item.walletId}:${item.id}`))

  const next: Cursor = { v: 1, arms: {} }
  let exhausted = true
  for (const read of reads) {
    const id = read.arm.walletId
    if (read.mark === 'done') {
      next.arms[id] = 'done'
      continue
    }
    if (read.status !== 'ok') {
      // Out for the rest of this feed. Its rows would land under older ones
      // if it rejoined; reading from the top is how it comes back.
      next.arms[id] = { skip: read.status }
      continue
    }
    const mine = read.items.filter((item) => shown.has(`${item.walletId}:${item.id}`))
    const allShown = mine.length === read.items.length
    if (allShown && !read.more) {
      next.arms[id] = 'done'
      continue
    }
    exhausted = false
    const last = mine.at(-1)
    if (!last) {
      // Nothing shown. Either the rows sit below the watermark and the bound
      // stands, or the page had nothing new and the bound has to move.
      const kept = read.items.length > 0 ? read.mark : advance(read.mark, read.raw)
      if (kept) next.arms[id] = kept
      continue
    }
    const seen = mine.filter((item) => item.minedAt === last.minedAt).map((item) => item.id)
    // The bound did not move if the page ended inside the second the last one
    // did, and the ids already dropped there are still to be dropped.
    if (read.mark && 'before' in read.mark && read.mark.before === last.minedAt) seen.push(...read.mark.seen)
    // A second too busy to remember is jumped: the rows shown at it are all
    // the feed will show of it.
    next.arms[id] = seen.length > MAX_SEEN ? { before: secondBefore(last.minedAt), seen: [] } : { before: last.minedAt, seen }
  }

  const chains = new Map<string, ActivityChain>()
  for (const item of items) {
    if (chains.has(item.chainId)) continue
    chains.set(item.chainId, {
      chainId: item.chainId,
      name: connector.chainName?.(item.chainId) ?? item.chainId,
      iconUrl: connector.chainIcon?.(item.chainId) ?? null,
    })
  }

  return {
    provider: connector.provider,
    items,
    cursor: exhausted ? null : encodeCursor(next),
    arms: reads.map((read) => ({ walletId: read.arm.walletId, address: read.arm.address, status: read.status })),
    chains: [...chains.values()],
  }
}
