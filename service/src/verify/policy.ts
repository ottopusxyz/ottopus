import { type Hex, decodeFunctionData, maxUint256, toFunctionSignature } from 'viem'
import {
  type Call,
  type DecodedAction,
  type Intent,
  type TransferIntent,
  type Warning,
  accountOn,
  chainName,
  isNativeAsset,
  parseAccountId,
  parseAssetId,
  parseChainId,
  sameChain,
  sourceChainOf,
} from '../core/index.js'
import { KNOWN_ABI, KNOWN_BY_SELECTOR } from './abi.js'

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

/**
 * What the calldata says, read here and not taken from the decoded action.
 *
 * The decoded actions are evidence for the page. The policy must not trust
 * them for anything it can read itself: if the actions and the calls ever
 * disagreed — a bug, or a tampered plan — a check that read the actions
 * would pass the calldata it never looked at. Only the shipped ABI is used,
 * because only the shipped ABI is ours.
 */
interface Read {
  signature: string
  args: readonly unknown[]
}

function readCalldata(call: Call): Read | null {
  if (call.data === '0x' || call.data === '') return null
  const item = KNOWN_BY_SELECTOR.get(call.data.slice(0, 10))
  if (!item) return null
  try {
    const { args } = decodeFunctionData({ abi: KNOWN_ABI, data: call.data as Hex })
    return { signature: toFunctionSignature(item), args: args ?? [] }
  } catch {
    return null
  }
}

/** An approval the calldata itself carries, by the same reading the decoder uses. */
function approvalIn(call: Call): { spender: string; amount: bigint | 'unlimited' } | null {
  const read = readCalldata(call)
  if (!read) return null
  const chain = parseChainId(call.chainId)
  switch (read.signature) {
    case 'approve(address,uint256)':
    case 'increaseAllowance(address,uint256)': {
      const amount = read.args[1] as bigint
      return { spender: accountOn(chain, String(read.args[0])), amount: amount === maxUint256 ? 'unlimited' : amount }
    }
    case 'setApprovalForAll(address,bool)':
      return read.args[1] === true ? { spender: accountOn(chain, String(read.args[0])), amount: 'unlimited' } : null
    default:
      return null
  }
}

/** The calls and their decodings must pair up, or nothing below means anything. */
const pairing: Rule = ({ calls, decodedActions }) =>
  calls.length === decodedActions.length
    ? []
    : [{ block: `${calls.length} calls but ${decodedActions.length} decoded actions; the plan cannot be checked` }]

/**
 * The evidence must describe the calls it is attached to. Where the calldata
 * is something we can read ourselves, the decoded action has to say the same
 * — same target, same function, same arguments. Evidence that disagrees with
 * its calldata is either a decoder bug or a plan edited after decoding, and
 * both are reasons to stop.
 */
const evidenceMatchesCalls: Rule = ({ calls, decodedActions }) => {
  const findings: Finding[] = []
  calls.forEach((call, i) => {
    const action = decodedActions[i]
    if (!action) return
    if (action.target.toLowerCase() !== call.to.toLowerCase()) {
      findings.push({ block: `decoded action ${i + 1} describes ${short(action.target)}, but the call targets ${short(call.to)}` })
      return
    }
    if (action.value !== call.value) {
      findings.push({ block: `decoded action ${i + 1} says ${action.value} wei, but the call carries ${call.value}` })
    }
    const read = readCalldata(call)
    if (read === null) {
      if ((call.data === '0x' || call.data === '') && action.source !== 'native') {
        findings.push({ block: `decoded action ${i + 1} is ${action.function}, but the call carries no calldata` })
      }
      return
    }
    if (action.function !== read.signature) {
      findings.push({ block: `decoded action ${i + 1} is ${action.function}, but the calldata is ${read.signature}` })
      return
    }
    const mismatch = read.args.findIndex((v, j) => {
      const shown = action.args[j]?.value
      const actual = typeof v === 'bigint' ? v.toString() : typeof v === 'string' ? v.toLowerCase() : String(v)
      return shown !== actual
    })
    if (mismatch !== -1) {
      findings.push({ block: `decoded action ${i + 1} shows ${action.args[mismatch]?.name ?? `arg ${mismatch}`} as ${action.args[mismatch]?.value}, but the calldata says otherwise` })
    }
  })
  return findings
}

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

/**
 * Approvals are read off the calldata. The decoded action's approval is
 * consulted only where the calldata is not ours to read, so an approval a
 * verified ABI revealed still counts, while one the evidence merely claims
 * cannot hide a different one in the bytes.
 */
const approvals: Rule = ({ calls, decodedActions, allowedSpenders = [] }) => {
  const allowed = new Set(allowedSpenders.map((s) => s.toLowerCase()))
  const findings: Finding[] = []
  calls.forEach((call, i) => {
    const fromCalldata = approvalIn(call)
    const approval =
      fromCalldata ??
      (readCalldata(call) === null && decodedActions[i]?.approval
        ? { spender: decodedActions[i]!.approval!.spender, amount: decodedActions[i]!.approval!.amount }
        : null)
    if (!approval) return
    const { spender, amount } = approval
    if (amount === 'unlimited') {
      findings.push({ block: `an unlimited approval to ${short(spender)}; approvals are exact or nothing` })
    }
    if (!allowed.has(spender.toLowerCase())) {
      findings.push({ block: `an approval to ${short(spender)}, which the intent does not name` })
    }
  })
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
    if (call.data !== '0x' && call.data !== '') {
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
  // Read from the bytes, with our own ABI. The decoded action is not consulted
  // for this: it is what the page shows, and this is what the wallet sends.
  const read = readCalldata(call)
  if (read === null || read.signature !== 'transfer(address,uint256)') {
    findings.push({ block: `the call is ${read?.signature ?? action.function}, not transfer(address,uint256)` })
    return findings
  }
  const to = String(read.args[0]).toLowerCase()
  const amount = String(read.args[1])
  if (to !== recipient) {
    findings.push({ block: `the transfer goes to ${short(`${call.chainId}:${to}`)}, not to ${short(intent.to)}` })
  }
  if (amount !== intent.amount) {
    findings.push({ block: `the transfer moves ${amount}, but the intent says ${intent.amount}` })
  }
  return findings
}

const GLOBAL: readonly Rule[] = [
  pairing,
  evidenceMatchesCalls,
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
