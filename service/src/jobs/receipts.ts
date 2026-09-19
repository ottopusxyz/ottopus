import { type Hex, TransactionReceiptNotFoundError, createPublicClient, http } from 'viem'
import { type PlanStatus, rpcUrlFor, sourceChainOf, viemChainFor } from '../core/index.js'
import { PlanError, type PlanRecord, type TransitionInput } from '../plans/index.js'
import { RpcReadError } from '../verify/index.js'

/**
 * The receipt job: how a submitted plan reaches confirmed or failed when
 * nobody is holding the review page open.
 *
 * The browser watches the receipt too, and whichever of the two lands its
 * event first wins; the store's row lock refuses the second, and the second
 * treats that as agreement. Nothing here updates a row — an outcome is one
 * more event appended, with the transaction hash carried along so the plan
 * never forgets which transaction it became.
 *
 * Each plan is polled on its own backoff, so a transaction stuck for an hour
 * costs one read every few minutes rather than one every tick. Past a day
 * with no receipt the plan is marked failed with the reason `dropped`: a
 * wallet that replaced or dropped the transaction is not going to produce a
 * receipt for that hash, and a plan that reads "waiting for the chain"
 * forever is worse than one that says what is known.
 */

export type ReceiptOutcome = 'success' | 'reverted'

export interface ReceiptReader {
  /** The receipt for a hash, or null while the chain has not mined it. Throws when the chain cannot be read. */
  receipt(chainId: string, txHash: string): Promise<ReceiptOutcome | null>
}

export interface HttpReceiptOptions {
  rpcUrlTemplate?: string | undefined
  timeoutMs?: number
  fetch?: typeof fetch
}

/** Receipts over JSON-RPC, through the same registry and the same sanitised errors as the decoder's reads. */
export function httpReceiptReader(options: HttpReceiptOptions = {}): ReceiptReader {
  const doFetch = options.fetch ?? fetch
  const timeout = options.timeoutMs ?? 8_000
  return {
    async receipt(chainId, txHash) {
      const client = createPublicClient({
        chain: viemChainFor(chainId),
        transport: http(rpcUrlFor(chainId, options.rpcUrlTemplate), { timeout, fetchFn: doFetch }),
      })
      try {
        const receipt = await client.getTransactionReceipt({ hash: txHash as Hex })
        return receipt.status === 'success' ? 'success' : 'reverted'
      } catch (err) {
        if (err instanceof TransactionReceiptNotFoundError) return null
        throw new RpcReadError(chainId, err)
      }
    },
  }
}

/** First retry after this long; each miss doubles it. */
export const BACKOFF_BASE_MS = 10_000
export const BACKOFF_MAX_MS = 5 * 60_000
/** A hash with no receipt after this long was dropped or replaced. */
export const GIVE_UP_AFTER_MS = 24 * 60 * 60_000

export interface WatcherDeps {
  listSubmitted(): Promise<PlanRecord[]>
  transition(input: TransitionInput): Promise<PlanStatus>
  reader: ReceiptReader
  now?: () => number
  giveUpAfterMs?: number
  log?: (msg: string, extra?: Record<string, unknown>) => void
}

export interface TickReport {
  /** Plans currently submitted. */
  watched: number
  /** Of those, how many were due and got a read. */
  checked: number
  confirmed: number
  failed: number
  dropped: number
  /** Reads the chain refused; those plans back off and wait. */
  errors: number
}

interface Attempt {
  count: number
  nextAt: number
}

export class ReceiptWatcher {
  private readonly attempts = new Map<string, Attempt>()
  private readonly now: () => number
  private readonly giveUpAfter: number
  private readonly log: NonNullable<WatcherDeps['log']>

  constructor(private readonly deps: WatcherDeps) {
    this.now = deps.now ?? Date.now
    this.giveUpAfter = deps.giveUpAfterMs ?? GIVE_UP_AFTER_MS
    this.log = deps.log ?? (() => {})
  }

  async tick(): Promise<TickReport> {
    const report: TickReport = { watched: 0, checked: 0, confirmed: 0, failed: 0, dropped: 0, errors: 0 }
    const records = await this.deps.listSubmitted()
    report.watched = records.length

    // Forget plans that are no longer submitted: the browser, or a previous
    // tick, already wrote their outcome.
    const live = new Set(records.map(keyOf))
    for (const key of this.attempts.keys()) if (!live.has(key)) this.attempts.delete(key)

    for (const record of records) await this.check(record, report)
    return report
  }

  private async check(record: PlanRecord, report: TickReport): Promise<void> {
    const key = keyOf(record)
    const now = this.now()
    const attempt = this.attempts.get(key) ?? { count: 0, nextAt: 0 }
    if (now < attempt.nextAt) return

    const txHash = record.statusDetail?.txHash
    if (typeof txHash !== 'string') {
      // The store refuses a submission without one; this is a row from before
      // it did, and there is nothing to poll for.
      this.log('submitted plan has no tx hash', { planId: record.plan.id, version: record.plan.version })
      this.attempts.set(key, { count: attempt.count + 1, nextAt: now + BACKOFF_MAX_MS })
      return
    }
    const chain = sourceChainOf(record.plan.intent)
    const chainId = `${chain.namespace}:${chain.reference}`
    const base = { userId: record.plan.userId, planId: record.plan.id, version: record.plan.version }
    report.checked += 1

    if (now - Date.parse(record.statusAt) >= this.giveUpAfter) {
      await this.write({ ...base, to: 'failed', detail: { txHash, reason: 'dropped' } }, key)
      report.dropped += 1
      return
    }

    let outcome: ReceiptOutcome | null
    try {
      outcome = await this.deps.reader.receipt(chainId, txHash)
    } catch (err) {
      report.errors += 1
      this.log('receipt read failed', { planId: record.plan.id, chainId, err: String(err) })
      this.backOff(key, attempt, now)
      return
    }
    if (outcome === null) {
      this.backOff(key, attempt, now)
      return
    }
    if (outcome === 'success') {
      await this.write({ ...base, to: 'confirmed', detail: { txHash } }, key)
      report.confirmed += 1
    } else {
      await this.write({ ...base, to: 'failed', detail: { txHash, reason: 'reverted' } }, key)
      report.failed += 1
    }
  }

  private backOff(key: string, attempt: Attempt, now: number): void {
    const count = attempt.count + 1
    const delay = Math.min(BACKOFF_BASE_MS * 2 ** (count - 1), BACKOFF_MAX_MS)
    this.attempts.set(key, { count, nextAt: now + delay })
  }

  /** Append the outcome. A refusal means the browser got there first, and that is fine. */
  private async write(input: TransitionInput, key: string): Promise<void> {
    try {
      await this.deps.transition(input)
    } catch (err) {
      if (!(err instanceof PlanError && err.code === 'illegal_transition')) throw err
      this.log('outcome already recorded', { planId: input.planId, version: input.version, to: input.to })
    }
    this.attempts.delete(key)
  }
}

const keyOf = (record: PlanRecord) => `${record.plan.id}:${record.plan.version}`
