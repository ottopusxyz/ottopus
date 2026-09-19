import { parseAccountId, parseAssetId } from './caip.js'
import { chainName } from './chains.js'
import type { SwapIntent, TransferIntent } from './intent.js'
import type { PlanDraft } from './plan.js'

/**
 * Which wallet. Eligibility first, then a transparent score with a reason a
 * person can read. Security disqualifiers always beat price: nothing here
 * ever wins for being cheaper if it failed a check.
 *
 * For a transfer there is no route, so the score is mostly the filter and a
 * tie-break; the shape is what swap needs anyway — candidates in, one winner
 * plus the losers with reasons out — and it is built here so #22 adds terms
 * rather than a second scorer.
 */

/** A linked wallet as the scorer sees it, on the chain the intent executes on. */
export interface WalletCandidate {
  walletId: string
  /** CAIP-10 on the intent's chain. */
  account: string
  label: string | null
  /** Not watch-only, and ownership proved. */
  canSign: boolean
  /** Base units of the intent's asset this wallet holds on that chain. */
  assetBalance: bigint
  /** Base units of the chain's own currency, for gas. */
  gasBalance: bigint
}

/**
 * What is known about a route before scoring it. A transfer has no route and
 * passes none; a swap passes what the connector and the decoder said.
 */
export interface RouteFacts {
  /** Every contract the calls touch has verified source. */
  verifiedTargets: boolean
  /** Null when no simulation ran; false is a failure, never "unknown". */
  simulationOk: boolean | null
  unlimitedApproval: boolean
  /** The wallet can sign what the outcome needs (calls, typed data). */
  supportedCapability: boolean
  quoteExpiresAt?: string | undefined
}

/**
 * The weights, in the plan's own words. Points are USD-equivalent: a penalty
 * of 5 is "worth about five dollars of worse price", which is what lets a
 * penalty and a fee be subtracted from the same number. Decided Sep 9 with
 * the transfer slice; swap will tune the first two against real quotes.
 */
export const WEIGHTS = {
  /** A bridge is a second transaction and a wait. Worth avoiding for a small saving. */
  bridge: 5,
  /** An approval is a second signature and a standing allowance. */
  approval: 2,
  /** A minute of expected delay. Bridges and slow routes pay this. */
  perMinute: 0.1,
  /** A route touching an unverified contract. Not a disqualifier by itself; scoring still avoids it. */
  riskUnverified: 10,
  /** A wallet whose label says it is not for everyday sends. */
  preferenceReserved: 3,
} as const

/** Labels that say "not for everyday sends". A vault should lose a tie to a daily wallet. */
const RESERVED = /\b(vault|cold|hardware|ledger|trezor|safe|savings|treasury)\b/i

const short = (caip10: string) => {
  const { address } = parseAccountId(caip10)
  return `…${address.slice(-4)}`
}

/** A wallet's name for a sentence: the label, else a short form of its address. */
export function candidateName(c: Pick<WalletCandidate, 'label' | 'account'>): string {
  return c.label ? `${c.label} (${short(c.account)})` : `the wallet ending ${short(c.account)}`
}

/**
 * Hard security constraints. Any one of these ends a route's candidacy
 * before its price is looked at, and the reason says which.
 */
export function disqualify(facts: RouteFacts, now: Date = new Date()): string | null {
  if (!facts.supportedCapability) return 'the wallet cannot sign what this route needs'
  if (facts.simulationOk === false) return 'the simulation failed'
  if (facts.unlimitedApproval) return 'the route asks for an unlimited approval'
  if (!facts.verifiedTargets) return 'the route touches a contract with no verified source'
  if (facts.quoteExpiresAt && new Date(facts.quoteExpiresAt).getTime() <= now.getTime()) {
    return 'the quote has expired'
  }
  return null
}

export interface AssetWords {
  symbol: string
  decimals: number
}

function amountWords(units: bigint, asset: AssetWords): string {
  const base = 10n ** BigInt(asset.decimals)
  const whole = units / base
  const rest = units % base
  if (rest === 0n) return `${whole.toLocaleString('en-US')} ${asset.symbol}`
  const frac = rest.toString().padStart(asset.decimals, '0').slice(0, 4).replace(/0+$/, '')
  return `${whole.toLocaleString('en-US')}${frac ? `.${frac}` : ''} ${asset.symbol}`
}

/**
 * Why a wallet cannot make this transfer, or null if it can.
 *
 * Gas is "has any", not an estimate: a real estimate needs a simulation, and
 * a wallet with zero native balance is the case that actually happens. The
 * amount check for a native transfer is strict, so the transfer leaves
 * something behind for the gas that sends it.
 */
export function transferIneligibility(
  c: WalletCandidate,
  intent: TransferIntent,
  asset: AssetWords,
  native: boolean,
): string | null {
  return spendIneligibility(c, intent.amount, asset, native)
}

/**
 * Why a wallet cannot spend this much of an asset, or null if it can.
 *
 * The same question for a transfer and for a swap's input side: enough of the
 * asset, something to pay gas with, and a key that can sign. `amount` is null
 * for a swap quoted by its output, where how much goes in is not known until
 * a route comes back — then "holds some of it" is all that can be checked,
 * and the router's own revert is the backstop.
 */
export function spendIneligibility(
  c: WalletCandidate,
  amount: string | null,
  asset: AssetWords,
  native: boolean,
): string | null {
  const chain = chainName(parseAccountId(c.account))
  if (!c.canSign) return 'is watch-only and cannot sign'
  if (amount === null) {
    if (c.assetBalance === 0n) return `holds no ${asset.symbol} on ${chain}`
    if (!native && c.gasBalance === 0n) return `has nothing on ${chain} to pay gas with`
    return null
  }
  const need = BigInt(amount)
  if (native) {
    if (c.assetBalance <= need) {
      return c.assetBalance === 0n
        ? `holds no ${asset.symbol} on ${chain}`
        : `holds ${amountWords(c.assetBalance, asset)} on ${chain}, not enough to send ${amountWords(need, asset)} and still pay gas`
    }
    return null
  }
  if (c.assetBalance < need) {
    return c.assetBalance === 0n
      ? `holds no ${asset.symbol} on ${chain}`
      : `holds only ${amountWords(c.assetBalance, asset)} on ${chain}, short of ${amountWords(need, asset)}`
  }
  if (c.gasBalance === 0n) return `has nothing on ${chain} to pay gas with`
  return null
}

export interface ScoreInput {
  intent: TransferIntent
  candidates: readonly WalletCandidate[]
  asset: AssetWords
  native: boolean
}

export type ScoreOutcome =
  | { ok: true; resolution: PlanDraft['resolution']; walletId: string }
  | { ok: false; reasons: string[] }

interface Scored {
  candidate: WalletCandidate
  score: number
  notes: string[]
}

function scoreTransfer(c: WalletCandidate): Scored {
  const notes: string[] = []
  let score = 0
  if (c.label && RESERVED.test(c.label)) {
    score -= WEIGHTS.preferenceReserved
    notes.push(`is labelled ${c.label}, which reads as not for everyday sends`)
  }
  return { candidate: c, score, notes }
}

/**
 * Higher score first; between equal scores, the larger balance. The balance
 * is compared whole, as a bigint — never folded into the score as a number,
 * where 10^18 loses precision and a modulus would wrap.
 */
function byScoreThenBalance(a: Scored, b: Scored): number {
  if (a.score !== b.score) return b.score - a.score
  if (a.candidate.assetBalance === b.candidate.assetBalance) return 0
  return a.candidate.assetBalance > b.candidate.assetBalance ? -1 : 1
}

/**
 * The resolution: one wallet, why, and what lost.
 *
 * `fromAccount` on the intent means the person chose. The scorer then only
 * checks eligibility and says so — an override is not overridden.
 */
export function resolveTransferWallet({ intent, candidates, asset, native }: ScoreInput): ScoreOutcome {
  return chooseWallet({
    candidates,
    asset,
    native,
    amount: intent.amount,
    chain: chainName(parseAccountId(intent.to)),
    verb: 'send',
    fromAccount: intent.fromAccount ?? null,
  })
}

export interface SwapScoreInput {
  intent: SwapIntent
  candidates: readonly WalletCandidate[]
  /** Words for the asset going in. */
  asset: AssetWords
  native: boolean
}

/**
 * The same choice for a swap's input side.
 *
 * A route's price does not depend on which wallet signs it, so there is
 * nothing extra to score here: whoever can afford the input and pay gas is
 * eligible, and the same weights break the tie. What differs is the sentence,
 * because "enough to send" is the wrong verb for a swap.
 */
export function resolveSwapWallet({ intent, candidates, asset, native }: SwapScoreInput): ScoreOutcome {
  return chooseWallet({
    candidates,
    asset,
    native,
    // Quoted by its output, the input amount is not known yet.
    amount: intent.amountIn ?? null,
    chain: chainName(parseAssetId(intent.from)),
    verb: 'swap',
    fromAccount: intent.fromAccount ?? null,
  })
}

interface ChoiceInput {
  candidates: readonly WalletCandidate[]
  asset: AssetWords
  native: boolean
  amount: string | null
  chain: string
  verb: 'send' | 'swap'
  fromAccount: string | null
}

/**
 * One wallet, why, and what lost.
 *
 * `fromAccount` means the person chose. The scorer then only checks
 * eligibility and says so — an override is not overridden.
 */
function chooseWallet({ candidates, asset, native, amount, chain, verb, fromAccount }: ChoiceInput): ScoreOutcome {
  const need = amount === null ? null : amountWords(BigInt(amount), asset)

  if (fromAccount) {
    const chosen = candidates.find((c) => c.account.toLowerCase() === fromAccount.toLowerCase())
    if (!chosen) return { ok: false, reasons: [`${fromAccount} is not a linked wallet on ${chain}`] }
    const why = spendIneligibility(chosen, amount, asset, native)
    if (why) return { ok: false, reasons: [`${candidateName(chosen)} ${why}`] }
    return {
      ok: true,
      walletId: chosen.walletId,
      resolution: {
        account: { caip10: chosen.account, ...(chosen.label ? { label: chosen.label } : {}) },
        candidatesConsidered: candidates
          .filter((c) => c !== chosen)
          .map((c) => ({ account: c.account, ...(c.label ? { label: c.label } : {}), reason: 'not considered — you chose the wallet' })),
        reason: `You chose ${candidateName(chosen)}. It holds ${amountWords(chosen.assetBalance, asset)} on ${chain} and has gas.`,
      },
    }
  }

  const eligible: Scored[] = []
  const losers: { account: string; label?: string; reason: string }[] = []
  for (const c of candidates) {
    const why = spendIneligibility(c, amount, asset, native)
    if (why) losers.push({ account: c.account, ...(c.label ? { label: c.label } : {}), reason: why })
    else eligible.push(scoreTransfer(c))
  }
  if (eligible.length === 0) {
    return {
      ok: false,
      reasons:
        losers.length === 0
          ? [`no linked wallet is on ${chain}`]
          : losers.map((l) => `${candidateName({ label: l.label ?? null, account: l.account })} ${l.reason}`),
    }
  }

  eligible.sort(byScoreThenBalance)
  const winner = eligible[0]!
  for (const s of eligible.slice(1)) {
    losers.push({
      account: s.candidate.account,
      ...(s.candidate.label ? { label: s.candidate.label } : {}),
      reason:
        s.notes[0] ??
        `holds ${amountWords(s.candidate.assetBalance, asset)} on ${chain}, less than ${candidateName(winner.candidate)}`,
    })
  }
  const because = [
    need === null
      ? `holds ${amountWords(winner.candidate.assetBalance, asset)} on ${chain}`
      : `holds ${amountWords(winner.candidate.assetBalance, asset)} on ${chain}, enough to ${verb} ${need}`,
    'has gas',
    ...(eligible.length > 1 ? [`of ${eligible.length} wallets that could, it holds the most`] : []),
  ]
  return {
    ok: true,
    walletId: winner.candidate.walletId,
    resolution: {
      account: { caip10: winner.candidate.account, ...(winner.candidate.label ? { label: winner.candidate.label } : {}) },
      candidatesConsidered: losers,
      reason: `Recommended ${candidateName(winner.candidate)} because it ${because.join(', ')}.`,
    },
  }
}
