import {
  type Call,
  type DecodedAction,
  type Intent,
  type TransferIntent,
  type Warning,
  chainName,
  isNativeAsset,
  parseAccountId,
  parseAssetId,
  parseChainId,
  sameChain,
  sourceChainOf,
} from '../core/index.js'

/**
 * Does this plan do what the intent says?
 *
 * The route provider, the agent and the decoder are all untrusted inputs, so
 * the check has to be ours, and it runs after decoding and before hashing: a
 * plan that fails never gets a review link. The rules are small for a
 * transfer, which is the point of landing the layer now. Swap (#22) and
 * agent-crafted plans (#78) add rules here rather than checking themselves.
 *
 * A reason is a sentence a person can read. The agent gets it back and the
 * review page shows it, so "amount mismatch" is not good enough.
 */

export interface VerifyInput {
  intent: Intent
  calls: readonly Call[]
  decodedActions: readonly DecodedAction[]
  /**
   * Spenders the intent legitimately needs — a swap's router, a supply's pool.
   * A transfer names none, so any approval in a transfer plan is blocked.
   */
  allowedSpenders?: readonly string[]
}

export type Verdict =
  | { ok: true; warnings: Warning[] }
  | { ok: false; reasons: string[]; warnings: Warning[] }

type Finding = { block: string } | { warn: Warning }

type Rule = (input: VerifyInput) => Finding[]

const short = (caip10: string) => {
  const { address } = parseAccountId(caip10)
  return `${address.slice(0, 6)}…${address.slice(-4)}`
}

/** The calls and their decodings must pair up, or nothing below means anything. */
const pairing: Rule = ({ calls, decodedActions }) =>
  calls.length === decodedActions.length
    ? []
    : [{ block: `${calls.length} calls but ${decodedActions.length} decoded actions; the plan cannot be checked` }]

const sameChainAsIntent: Rule = ({ intent, calls }) => {
  const chain = sourceChainOf(intent)
  return calls
    .filter((c) => !sameChain(parseChainId(c.chainId), chain))
    .map((c) => ({ block: `a call targets ${chainName(c.chainId)}, but the intent is on ${chainName(chain)}` }))
}

/**
 * A delegatecall runs someone else's code as the wallet. Nothing a route
 * provider builds for a transfer or a swap needs one; anything that carries
 * one is not a plan we can explain. The check reads the decoded name, which
 * is what we have before simulation (#23) can see the call tree.
 */
const noDelegatecall: Rule = ({ decodedActions }) =>
  decodedActions
    .filter((a) => /delegat/i.test(a.function))
    .map((a) => ({ block: `${a.function} on ${short(a.target)} is a delegatecall, which is never allowed` }))

const approvals: Rule = ({ decodedActions, allowedSpenders = [] }) => {
  const allowed = new Set(allowedSpenders.map((s) => s.toLowerCase()))
  const findings: Finding[] = []
  for (const action of decodedActions) {
    if (!action.approval) continue
    const { spender, amount } = action.approval
    if (amount === 'unlimited') {
      findings.push({ block: `an unlimited approval to ${short(spender)}; approvals are exact or nothing` })
    }
    if (!allowed.has(spender.toLowerCase())) {
      findings.push({ block: `an approval to ${short(spender)}, which the intent does not name` })
    }
  }
  return findings
}

/**
 * Native value only where the intent spends the chain's own currency. A
 * token transfer carrying ETH is ETH leaving the wallet that nobody asked
 * to send.
 */
const nativeValue: Rule = ({ intent, calls }) => {
  const sourceAsset = intent.kind === 'swap' ? intent.from : intent.asset
  if (isNativeAsset(sourceAsset)) return []
  return calls
    .filter((c) => c.value !== '0')
    .map((c) => ({ block: `${c.value} wei of native value to ${short(c.to)}, which the intent did not ask for` }))
}

/** Not blocking, but the page must say it. */
const unverifiedTargets: Rule = ({ decodedActions }) =>
  decodedActions
    .filter((a) => a.isContract && !a.verified)
    .map((a) => ({
      warn: {
        severity: 'caution' as const,
        code: 'unverified_contract',
        message: `${short(a.target)} has no verified source; what it does cannot be read`,
        saferAlternative: 'Prefer a route whose contracts are verified.',
      },
    }))

const unknownCalldata: Rule = ({ decodedActions }) =>
  decodedActions
    .filter((a) => a.source === 'unknown')
    .map((a) => ({
      warn: {
        severity: 'caution' as const,
        code: 'unknown_calldata',
        message: `the call to ${short(a.target)} could not be decoded`,
        saferAlternative: 'Only sign calldata you can read.',
      },
    }))

/**
 * A transfer is one call that moves exactly the asset, exactly the amount, to
 * exactly the recipient. Anything else is a different transaction wearing the
 * intent's name.
 */
const transferRules: Rule = (input) => {
  const intent = input.intent as TransferIntent
  const { calls, decodedActions } = input
  if (calls.length !== 1) {
    return [{ block: `a transfer is one call; this plan has ${calls.length}` }]
  }
  const call = calls[0]!
  const action = decodedActions[0]!
  const recipient = parseAccountId(intent.to).address
  const findings: Finding[] = []

  if (isNativeAsset(intent.asset)) {
    if (parseAccountId(call.to).address !== recipient) {
      findings.push({ block: `the call sends to ${short(call.to)}, not to ${short(intent.to)}` })
    }
    if (call.value !== intent.amount) {
      findings.push({ block: `the call sends ${call.value} wei, but the intent says ${intent.amount}` })
    }
    if (action.source !== 'native') {
      findings.push({ block: `a native transfer carries calldata (${action.function}); it should carry none` })
    }
    return findings
  }

  const token = parseAssetId(intent.asset).assetReference
  if (parseAccountId(call.to).address !== token) {
    findings.push({ block: `the call targets ${short(call.to)}, not the token ${short(`${call.chainId}:${token}`)}` })
    return findings
  }
  if (!action.isContract) {
    findings.push({ block: `the token address ${short(call.to)} has no code on ${chainName(call.chainId)}` })
  }
  if (action.function !== 'transfer(address,uint256)') {
    findings.push({ block: `the call is ${action.function}, not transfer(address,uint256)` })
    return findings
  }
  const [to, amount] = action.args
  if (to?.value !== recipient) {
    findings.push({ block: `the transfer goes to ${short(`${call.chainId}:${to?.value}`)}, not to ${short(intent.to)}` })
  }
  if (amount?.value !== intent.amount) {
    findings.push({ block: `the transfer moves ${amount?.value}, but the intent says ${intent.amount}` })
  }
  return findings
}

const GLOBAL: readonly Rule[] = [
  pairing,
  sameChainAsIntent,
  noDelegatecall,
  approvals,
  nativeValue,
  unverifiedTargets,
  unknownCalldata,
]

const BY_KIND: Readonly<Record<Intent['kind'], readonly Rule[]>> = {
  transfer: [transferRules],
  // Swap rules land with #22; bridge and supply with #80 and #79. Until then a
  // plan of those kinds fails closed rather than passing on global rules alone.
  swap: [() => [{ block: 'swap plans cannot be verified yet' }]],
  bridge: [() => [{ block: 'bridge plans cannot be verified yet' }]],
  supply: [() => [{ block: 'supply plans cannot be verified yet' }]],
}

export function verifyPlan(input: VerifyInput): Verdict {
  const findings: Finding[] = []
  for (const rule of GLOBAL) findings.push(...rule(input))
  // Intent rules index into the pairing; if the pairing is broken they would
  // be reading the wrong action, so they only run once it holds.
  if (input.calls.length === input.decodedActions.length) {
    for (const rule of BY_KIND[input.intent.kind]) findings.push(...rule(input))
  }

  const reasons = findings.flatMap((f) => ('block' in f ? [f.block] : []))
  const warnings = findings.flatMap((f) => ('warn' in f ? [f.warn] : []))
  return reasons.length === 0 ? { ok: true, warnings } : { ok: false, reasons, warnings }
}

/**
 * The reasons as warnings, so a blocked plan can carry them in its human
 * plan and the review page and Activity show why with no second field.
 */
export function blockWarnings(verdict: Verdict): Warning[] {
  if (verdict.ok) return verdict.warnings
  return [
    ...verdict.reasons.map((reason) => ({ severity: 'block' as const, code: 'verify_failed', message: reason })),
    ...verdict.warnings,
  ]
}
