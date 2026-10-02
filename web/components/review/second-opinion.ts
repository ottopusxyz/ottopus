import type { BinanceSimulation, Plan, Simulation } from '@/lib/api'
import { formatAmount, truncateAddress } from '@/lib/format'
import { type AssetChange, assetWords, chainOfPlan, holderOf, observedRow } from './model'

/**
 * Binance's simulation of the plan, as the advanced panel shows it beside the
 * page's own.
 *
 * A second source, read for the person and for nobody else: nothing here
 * reaches the sign button, the status or the hash. When the two simulators
 * disagree the field says so in one line and leaves the decision where it
 * was. No answer is a quiet line, because a vendor being down says nothing
 * about the plan.
 */

export interface AllowanceRow {
  /** "USDC", or the token's address when the plan does not name it. */
  token: string
  spender: string
  before: string
  after: string
}

export type SecondOpinion =
  | { kind: 'unavailable'; line: string }
  | { kind: 'failed'; provenance: string; reason: string; note: string | null }
  | {
      kind: 'ok'
      provenance: string
      rows: AssetChange[]
      allowances: AllowanceRow[]
      /** `alone` when there is nothing to hold it against: no traced balances, or none the two can be compared on. */
      verdict: 'agree' | 'differ' | 'alone'
      note: string | null
    }

/**
 * What Binance made of one call. `dependent` is a refusal of a call that
 * follows another: Binance runs each alone, so that is its method and not a
 * finding. `skipped` is a call after the one it refused, which it never ran.
 */
export type CallVerdict = 'passed' | 'failed' | 'dependent' | 'skipped'

/**
 * Binance's verdict on each of the plan's calls, in order, for the decoded
 * list to wear. Null when there is none to give: no answer, or a refusal the
 * vendor did not pin to a call.
 */
export function callVerdicts(binance: BinanceSimulation, count: number): CallVerdict[] | null {
  if (binance.status === 'unavailable') return null
  if (binance.status === 'SUCCESS') return Array.from({ length: count }, () => 'passed' as const)
  const failed = binance.failedCall
  if (failed === null || failed < 1 || failed > count) return null
  return Array.from({ length: count }, (_, i) =>
    i + 1 < failed ? 'passed' : i + 1 > failed ? 'skipped' : failed > 1 ? 'dependent' : 'failed',
  )
}

/**
 * How far two figures for the same asset may sit apart and still agree, in
 * basis points. The two runs are against different blocks, and a swap's
 * output moves with the pool between them; a per-cent of drift is the market,
 * not a disagreement.
 */
export const DRIFT_BPS = 100n

/** At or past this an allowance is the "infinite" approval, whatever its exact bytes. */
const UNLIMITED = 1n << 255n

export function secondOpinion(plan: Plan, own: Simulation | null, binance: BinanceSimulation): SecondOpinion {
  if (binance.status === 'unavailable') {
    return { kind: 'unavailable', line: `No Binance simulation: ${binance.failReason ?? 'it did not answer'}.` }
  }
  // The vendor simulates against the chain head and names no block, so the
  // time is the provenance. Saying a block number here would be inventing one.
  const provenance = `Simulated by Binance Web3 API against the latest block, at ${timeOf(binance.ranAt)} UTC.`

  if (binance.status === 'FAILED') {
    return {
      kind: 'failed',
      provenance,
      reason: binance.failReason ?? 'Binance gave no reason',
      note:
        // Each call runs alone there. A swap without the approve before it
        // fails on the allowance, which is the vendor's method and not a
        // finding about the plan.
        binance.failedCall !== null && binance.failedCall > 1
          ? 'Binance runs each call on its own, so a call that relies on the one before it fails there.'
          : own?.success
            ? 'The page’s own run passed. The two disagree.'
            : null,
    }
  }

  const holder = holderOf(plan)
  const chain = chainOfPlan(plan)
  const rows = binance.balanceChanges.map((delta) => observedRow(delta, holder))
  const allowances = binance.allowanceChanges.map((change) => {
    const words = assetWords(plan, `${chain}/erc20:${change.tokenAddress}`)
    const amount = (value: string) => allowanceAmount(value, words?.decimals ?? null)
    return {
      token: words?.symbol ?? truncateAddress(change.tokenAddress),
      spender: truncateAddress(change.spender),
      before: amount(change.preAmount),
      after: amount(change.postAmount),
    }
  })

  if (own && !own.success) {
    return {
      kind: 'ok',
      provenance,
      rows,
      allowances,
      verdict: 'differ',
      note: 'Binance passes this where the page’s own run reverts. Binance checks neither the balance nor the gas.',
    }
  }
  const traced = own?.assetChanges ?? []
  if (traced.length === 0) return { kind: 'ok', provenance, rows, allowances, verdict: 'alone', note: null }

  const { apart, compared } = differing(traced, binance.balanceChanges, nativeIdOf(traced, binance.balanceChanges))
  // Only the chain's own currency moved, and that row is never compared.
  // Calling that agreement would be a verdict with nothing behind it.
  if (compared === 0) {
    return {
      kind: 'ok',
      provenance,
      rows,
      allowances,
      verdict: 'alone',
      note: 'Not compared with the page’s own run: only the chain’s own currency moves, and Binance does not count gas.',
    }
  }
  return apart.length === 0
    ? { kind: 'ok', provenance, rows, allowances, verdict: 'agree', note: 'Agrees with the page’s own run.' }
    : {
        kind: 'ok',
        provenance,
        rows,
        allowances,
        verdict: 'differ',
        note: `Differs from the page’s own run on ${list(apart)}.`,
      }
}

type Delta = Pick<Simulation['assetChanges'][number], 'assetId' | 'symbol' | 'diff'>

/**
 * The chain's own currency, which is left out of the comparison: the page's
 * run pays gas out of it and Binance's does not count gas at all, so the two
 * never match on that row and saying so every time would bury a real
 * difference.
 */
function nativeIdOf(...sides: readonly Delta[][]): string | null {
  for (const side of sides) {
    const hit = side.find((delta) => delta.assetId.includes('/slip44:'))
    if (hit) return hit.assetId.toLowerCase()
  }
  return null
}

/**
 * The symbols the two runs do not agree on: missing from one, the other way,
 * or further apart than drift. `compared` is how many assets were held
 * against each other at all.
 */
function differing(
  own: readonly Delta[],
  theirs: readonly Delta[],
  nativeId: string | null,
): { apart: string[]; compared: number } {
  const mine = new Map(own.map((delta) => [delta.assetId.toLowerCase(), delta]))
  const other = new Map(theirs.map((delta) => [delta.assetId.toLowerCase(), delta]))
  const apart: string[] = []
  let compared = 0
  for (const id of new Set([...mine.keys(), ...other.keys()])) {
    if (id === nativeId) continue
    compared += 1
    const a = mine.get(id)
    const b = other.get(id)
    if (!a || !b || !within(BigInt(a.diff), BigInt(b.diff))) apart.push((a ?? b)!.symbol ?? 'an unnamed token')
  }
  return { apart, compared }
}

function within(a: bigint, b: bigint): boolean {
  if (a === b) return true
  if (a < 0n !== b < 0n) return false
  const [x, y] = [abs(a), abs(b)]
  const [small, large] = x < y ? [x, y] : [y, x]
  return (large - small) * 10_000n <= large * DRIFT_BPS
}

function abs(value: bigint): bigint {
  return value < 0n ? -value : value
}

function allowanceAmount(value: string, decimals: number | null): string {
  if (!/^[0-9]+$/.test(value)) return value
  if (BigInt(value) >= UNLIMITED) return 'unlimited'
  return decimals === null ? value : formatAmount(value, decimals)
}

function list(words: readonly string[]): string {
  return words.length <= 1 ? (words[0] ?? '') : `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`
}

/** "14:03:22". In UTC so the line reads the same wherever it is opened. */
function timeOf(iso: string): string {
  const at = new Date(iso)
  return Number.isNaN(at.getTime()) ? 'an unknown time' : at.toISOString().slice(11, 19)
}
