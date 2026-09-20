import { type Hex, decodeFunctionData, maxUint160, maxUint256, toFunctionSignature } from 'viem'
import {
  type BuiltIntent,
  type Call,
  type CustomIntent,
  type DecodedAction,
  type Intent,
  type Simulation,
  type TradeIntent,
  type TransferIntent,
  type Warning,
  accountOn,
  chainName,
  crossesChains,
  isNativeAsset,
  parseAccountId,
  parseAssetId,
  parseChainId,
  sameChain,
  sourceAssetOf,
  sourceChainOf,
} from '../core/index.js'
import { KNOWN_ABI, KNOWN_BY_SELECTOR, PERMIT2_APPROVE } from './abi.js'

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
  /**
   * What the simulation observed, when one ran. Null or absent is "not
   * observed" and never counts against a plan: a chain no simulator serves
   * still gets reviewed, on the decoded intent alone.
   */
  simulation?: Simulation | null
  /**
   * The route's own promise, from the quote. A swap is reviewed on its floor,
   * so the policy checks the floor is coherent before a page can show it.
   */
  quote?:
    | {
        expectedOut?: string | undefined
        minOut?: string | undefined
        /** Native value the route declared it needs alongside a token input. */
        nativeFee?: string | undefined | null
      }
    | undefined
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
    case PERMIT2_APPROVE: {
      const amount = read.args[2] as bigint
      return { spender: accountOn(chain, String(read.args[1])), amount: amount === maxUint160 ? 'unlimited' : amount }
    }
    default:
      return null
  }
}

/**
 * A Permit2 grant, if this is one: the token, who may draw it, how much, and
 * until when. Permit2's own "forever" is the maximum uint48.
 */
function permit2GrantIn(call: Call): { token: string; spender: string; amount: bigint | 'unlimited'; forever: boolean } | null {
  const read = readCalldata(call)
  if (read?.signature !== PERMIT2_APPROVE) return null
  const chain = parseChainId(call.chainId)
  const amount = read.args[2] as bigint
  return {
    token: String(read.args[0]).toLowerCase(),
    spender: accountOn(chain, String(read.args[1])),
    amount: amount === maxUint160 ? 'unlimited' : amount,
    // viem hands a uint48 back as a number.
    forever: BigInt(read.args[3] as number | bigint) === MAX_UINT48,
  }
}

const MAX_UINT48 = (1n << 48n) - 1n

/**
 * How much goes in, when the intent fixes it. Null for a trade quoted by its
 * output, and for anything with no fixed input to measure against.
 */
function amountInOf(intent: BuiltIntent): bigint | null {
  if (intent.kind === 'swap' || intent.kind === 'bridge') {
    return intent.amountIn === undefined ? null : BigInt(intent.amountIn)
  }
  return BigInt(intent.amount)
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
const nativeValue: Rule = ({ intent, calls, quote }) => {
  // A custom intent declares its own native value and the custom tier holds
  // the calls to that; this rule is about a route's fee against a built intent.
  if (intent.kind === 'custom') return []
  if (isNativeAsset(sourceAssetOf(intent))) return []
  const declared = quote?.nativeFee ? BigInt(quote.nativeFee) : 0n
  const findings: Finding[] = []
  let allowance = declared
  for (const call of calls) {
    if (call.value === '0') continue
    const value = BigInt(call.value)
    // Spend the declaration once. A route that declared a fee does not get
    // to charge it on every call in the batch.
    if (value <= allowance) {
      allowance -= value
      findings.push({
        warn: {
          severity: 'caution' as const,
          code: 'route_native_fee',
          message: `this route also sends ${call.value} wei of ${chainName(call.chainId)}'s own currency as its fee`,
        },
      })
      continue
    }
    findings.push({
      block:
        declared === 0n
          ? `${call.value} wei of native value to ${short(call.to)}, which the intent did not ask for`
          : `${call.value} wei of native value to ${short(call.to)}, above the ${declared} the route declared`,
    })
  }
  return findings
}

/**
 * A simulation that ran and said no.
 *
 * The strongest signal the policy has, and the only one that comes from
 * executing the calls rather than reading them. Blocking here rather than
 * warning: a plan the chain has already refused cannot be signed into
 * anything but a wasted fee.
 */
const simulationOutcome: Rule = ({ simulation }) => {
  if (!simulation || simulation.success) return []
  const which = simulation.failedCall ? `call ${simulation.failedCall}` : 'the batch'
  const why = simulation.revertReason ? `: ${simulation.revertReason}` : ''
  return [{ block: `the simulation failed on ${which}${why}` }]
}

/**
 * What the simulation saw leave, against what the plan says leaves.
 *
 * This is the one check that can catch a call whose bytes are honest and
 * whose effect is not — a token whose `transfer` moves a second balance, a
 * proxy pointing somewhere new. The decoder reads intent; this reads outcome.
 *
 * Asymmetric on purpose. More of the intended asset leaving than the plan
 * promised is unambiguous and blocks. Less, or none observed, only warns:
 * fee-on-transfer and rebasing tokens make the exact figure a bad thing to
 * fail closed on, and nobody is harmed by a plan that moves less than they
 * agreed to. A *different* asset leaving is always a block, whatever its
 * size, because the person never agreed to that one at all.
 */
const simulationMatchesIntent: Rule = ({ intent, simulation }) => {
  // A custom intent has a list of bounds rather than one source asset; the
  // custom tier compares the run against the declaration instead.
  if (intent.kind === 'custom') return []
  if (!simulation || !simulation.success || simulation.assetChanges.length === 0) return []
  const sourceAsset = sourceAssetOf(intent).toLowerCase()
  // A trade quoted by amountOut has no fixed input, so there is no promise to
  // measure against; the other-asset rule below still applies.
  const promised = amountInOf(intent)
  const findings: Finding[] = []
  const mine = simulation.assetChanges.find((c) => c.assetId.toLowerCase() === sourceAsset)

  for (const change of simulation.assetChanges) {
    if (change.assetId.toLowerCase() === sourceAsset) continue
    if (BigInt(change.diff) >= 0n) continue
    const name = change.symbol ?? change.assetId
    findings.push({
      block: `the simulation shows ${name} leaving the wallet as well, which the plan does not mention`,
    })
  }

  if (promised === null) return findings
  if (!mine) {
    findings.push({
      warn: {
        severity: 'caution' as const,
        code: 'simulation_no_source_change',
        message: 'the simulation did not observe the asset the plan says is being sent',
        saferAlternative: 'Check the decoded call below before signing.',
      },
    })
    return findings
  }
  const left = -BigInt(mine.diff)
  if (left > promised) {
    findings.push({
      block: `the simulation shows ${left} leaving, but the plan says ${promised}`,
    })
  } else if (left < promised) {
    findings.push({
      warn: {
        severity: 'caution' as const,
        code: 'simulation_amount_below_plan',
        message: `the simulation shows ${left} leaving where the plan says ${promised}; the token may take a fee`,
      },
    })
  }
  return findings
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

/**
 * A swap is an allowance and a router call, or just a router call.
 *
 * The router's calldata is not ours to read — every aggregator encodes its
 * own — so the checks here are the ones that hold whatever the bytes say:
 * how much is approved, to whom, that the approved spender is the contract
 * actually called, that native value only moves when the input is native,
 * and that the quote commits to a floor. What the calls *do* is the
 * simulation's job, and the rule above already blocks an asset leaving that
 * the intent never named.
 *
 * The allowance takes one of two shapes. The plain one is an approval on the
 * token to the router. The other is Permit2's: the token is approved to the
 * allowance contract, and the allowance contract is told the router may draw
 * that much until a deadline. Two calls, each exact, and the second names
 * the first's spender as its own target — that pairing is what makes it one
 * allowance rather than two, and it is checked as such. An allowance that
 * never expires is refused there, as an unlimited one is here.
 */
const tradeRules: Rule = (input) => {
  const intent = input.intent as TradeIntent
  const { calls, decodedActions } = input
  const findings: Finding[] = []

  if (calls.length === 0 || calls.length > 3) {
    return [{ block: `a trade is one router call, with an allowance at most; this plan has ${calls.length}` }]
  }
  const router = calls[calls.length - 1]!
  const routerAction = decodedActions[calls.length - 1]
  const nativeIn = isNativeAsset(intent.from)

  if (routerAction && !routerAction.isContract) {
    findings.push({ block: `the trade targets ${short(router.to)}, which has no code on ${chainName(router.chainId)}` })
  }

  // The allowance, if the plan carries one, read off the calldata.
  const approval = calls.length >= 2 ? approvalIn(calls[0]!) : null
  if (calls.length >= 2 && !approval) {
    findings.push({ block: 'the first call in a trade must be the approval; this one is not' })
  }
  const grant = calls.length === 3 ? permit2GrantIn(calls[1]!) : null
  if (calls.length === 3 && !grant) {
    findings.push({ block: 'a trade of three calls is an approval, a Permit2 grant and the router call; the second is not a Permit2 grant' })
  }

  if (nativeIn) {
    if (approval) {
      findings.push({ block: 'the input is the chain’s own currency, which cannot be approved and needs no allowance' })
    }
    if (intent.amountIn !== undefined && router.value !== intent.amountIn) {
      findings.push({ block: `the call sends ${router.value} wei, but the intent says ${intent.amountIn}` })
    }
  } else if (approval) {
    const token = parseAssetId(intent.from).assetReference
    // Exact. Whichever shape, a trade approves what it spends and no more.
    const exact = (amount: bigint | 'unlimited', spender: string) => {
      if (amount === 'unlimited') {
        findings.push({ block: `an unlimited approval to ${short(spender)}; a trade approves exactly what it spends` })
      } else if (intent.amountIn !== undefined && amount !== BigInt(intent.amountIn)) {
        findings.push({
          block: `the plan approves ${amount} but the intent spends ${intent.amountIn}; a trade approves exactly what it spends`,
        })
      }
    }
    exact(approval.amount, approval.spender)
    if (parseAccountId(calls[0]!.to).address !== token) {
      findings.push({ block: `the approval is on ${short(calls[0]!.to)}, not on the token being spent` })
    }

    if (grant) {
      // The token is approved to the allowance contract, which then lets the
      // router draw it. Each link is checked: an allowance contract that is
      // not the one approved, or a grant to somewhere other than the router,
      // is the shape a drain takes with an extra step in it.
      exact(grant.amount, grant.spender)
      if (parseAccountId(calls[1]!.to).address !== parseAccountId(approval.spender).address) {
        findings.push({
          block: `the approval lets ${short(approval.spender)} spend, but the grant is made on ${short(calls[1]!.to)}`,
        })
      }
      if (grant.token !== token) {
        findings.push({ block: `the grant is for ${short(accountOn(parseChainId(router.chainId), grant.token))}, not the token being spent` })
      }
      if (parseAccountId(grant.spender).address !== parseAccountId(router.to).address) {
        findings.push({
          block: `the grant lets ${short(grant.spender)} spend, but the call goes to ${short(router.to)}`,
        })
      }
      if (grant.forever) {
        findings.push({ block: `the grant to ${short(grant.spender)} never expires; a trade’s allowance ends with the trade` })
      }
    } else if (parseAccountId(approval.spender).address !== parseAccountId(router.to).address) {
      // An allowance to somewhere other than the target is the shape a drain takes.
      findings.push({
        block: `the approval lets ${short(approval.spender)} spend, but the call goes to ${short(router.to)}`,
      })
    }
  }

  // The floor is what the review page promises, so it has to be real.
  const { expectedOut, minOut } = input.quote ?? {}
  if (minOut === undefined) {
    findings.push({ block: 'the quote gives no minimum received; a trade cannot be reviewed without a floor' })
  } else if (BigInt(minOut) <= 0n) {
    findings.push({ block: 'the quote’s minimum received is zero; that is not a floor' })
  } else if (expectedOut !== undefined && BigInt(minOut) > BigInt(expectedOut)) {
    findings.push({ block: `the quote promises at least ${minOut} but expects only ${expectedOut}` })
  }

  /**
   * What the run observed arriving, when one has run. The only check that can
   * tell a promised floor from a kept one.
   *
   * It stands down for a bridge. The output lands on another chain, minutes
   * later, so a source-chain simulation cannot see it and an absent arrival
   * proves nothing — blocking on it would refuse every bridge. Explicit
   * rather than incidental: the rule is skipped because it cannot apply, not
   * because nobody thought about it.
   */
  const sim = input.simulation
  if (sim?.success && minOut !== undefined && !crossesChains(intent)) {
    const arrived = sim.assetChanges.find((c) => c.assetId.toLowerCase() === intent.to.toLowerCase())
    if (arrived && BigInt(arrived.diff) < BigInt(minOut)) {
      findings.push({
        block: `the simulation received ${arrived.diff}, below the ${minOut} the quote promised`,
      })
    }
  }
  return findings
}

/**
 * Whether a decoded call carries calldata inside its arguments.
 *
 * `bytes[]` is always a wrapper. A `bytes` argument that is not empty is
 * something the outer ABI declines to describe — a nested call, a
 * signature, a payload — and the only one of those this tier could vouch
 * for is the empty one. Tuples hide their component types behind `tuple`,
 * so their values are scanned: a hex string that is neither an address nor
 * a 32-byte word is treated as opaque. Conservative on purpose — a `bytes4`
 * field trips it too — because the failure the other way is an approval
 * nobody checked.
 */
function carriesOpaqueCalldata(action: DecodedAction): boolean {
  const opaqueHex = (s: unknown) =>
    typeof s === 'string' && /^0x[0-9a-f]*$/i.test(s) && s.length >= 10 && s.length !== 42 && s.length !== 66
  const scan = (v: unknown): boolean => {
    if (typeof v === 'string') return opaqueHex(v)
    if (Array.isArray(v)) return v.some(scan)
    if (v && typeof v === 'object') return Object.values(v).some(scan)
    return false
  }
  return action.args.some((arg) => {
    if (arg.type === 'bytes[]') return true
    if (arg.type === 'bytes') return arg.value !== '0x' && arg.value !== ''
    if (arg.type.startsWith('tuple')) {
      try {
        return scan(JSON.parse(arg.value))
      } catch {
        return false
      }
    }
    return false
  })
}

/**
 * The heightened tier for calls the agent authored.
 *
 * A route provider is untrusted but bounded: it builds one shape, and the
 * intent says what that shape must do. An agent authoring calls is untrusted
 * and unbounded, so the declaration takes the intent's place and the rules
 * tighten in four ways. The bytes must be readable from published source,
 * not named from a selector. Every approval must be one the declaration
 * named, at the amount it named, on the token it named. Native value must be
 * what was declared, spent once. And a simulation must have run, traced
 * balances, and seen nothing leave that the declaration did not allow.
 *
 * The asset check is an upper bound per asset, not an equality: slippage puts
 * the true figure inside a band, and "exactly declared" would ink honest
 * plans. Declaring more than leaves is loose but safe; declaring less is the
 * lie this tier exists to catch. Unlimited approvals and undeclared spenders
 * are already blocks in the global `approvals` rule, which `verifyPlan`
 * feeds the declared spenders.
 */
const customRules: Rule = (input) => {
  const intent = input.intent as CustomIntent
  const { calls, decodedActions, simulation } = input
  const findings: Finding[] = []

  decodedActions.forEach((a, i) => {
    if (a.source === 'native') {
      // A plain value transfer to a wallet is the one call with nothing to
      // read. To a contract it runs receive() or fallback(), and that code
      // has to be published like any other the plan executes.
      if (a.isContract && !a.verified) {
        findings.push({
          block: `call ${i + 1} sends value to ${short(a.target)}, a contract with no verified source; what its fallback does cannot be read`,
        })
      }
      return
    }
    if (!a.isContract) {
      findings.push({ block: `call ${i + 1} sends calldata to ${short(a.target)}, which has no code` })
      return
    }
    if (!a.verified) {
      findings.push({
        block: `${short(a.target)} has no verified source; an agent-authored plan may only call contracts whose code is published`,
      })
    }
    if (a.source === '4byte') {
      findings.push({
        block: `call ${i + 1} to ${short(a.target)} was named from a selector database, not from source; a guess is not enough for an agent-authored call`,
      })
    } else if (a.source === 'unknown') {
      findings.push({ block: `call ${i + 1} to ${short(a.target)} could not be read at all` })
    }
    // Reading the outer call is not reading what it carries. A `bytes[]` is
    // a wrapper — multicall, execute, batch — and a non-empty `bytes` is
    // calldata this tier cannot see into; an approval hidden in either passes
    // the checks below untouched. A caution, by decision, not a block: v3's
    // own decrease and native-side create arrive as a multicall, and refusing
    // every vendor bundle was judged too high a price. The page says what it
    // could not read; the person decides.
    if (carriesOpaqueCalldata(a)) {
      findings.push({
        warn: {
          severity: 'caution' as const,
          code: 'opaque_calldata',
          message: `call ${i + 1} to ${short(a.target)} (${a.function.replace(/\(.*$/, '')}) carries calldata inside its arguments that this page cannot read — an approval in there would not be caught`,
          saferAlternative: 'Prefer the same action as separate calls, each one readable, over a bundle.',
        },
      })
    }
  })

  // Every approval the bytes make, against the one the declaration made.
  const declared = intent.approvals.map((a) => ({
    token: parseAssetId(a.asset).assetReference.toLowerCase(),
    spender: parseAccountId(a.spender).address.toLowerCase(),
    amount: BigInt(a.amount),
  }))
  const matched = new Set<number>()
  for (const call of calls) {
    const approval = approvalIn(call)
    // Unlimited is the global rule's block; nothing to compare it to here.
    if (!approval || approval.amount === 'unlimited') continue
    // An allowance is set, never grown. `increaseAllowance` adds to whatever
    // stands, so two of them at the declared amount leave twice it — and the
    // declaration would have matched each one on its own.
    if (readCalldata(call)?.signature === 'increaseAllowance(address,uint256)') {
      findings.push({
        block: `an increaseAllowance to ${short(approval.spender)}; an agent-authored plan sets an allowance with approve, exactly, and never adds to one`,
      })
      continue
    }
    const token = parseAccountId(call.to).address.toLowerCase()
    const spender = parseAccountId(approval.spender).address.toLowerCase()
    const at = declared.findIndex((d) => d.token === token && d.spender === spender)
    if (at === -1) {
      // The global rule passes a declared spender whatever the token; the
      // declaration named a pairing, and this is not it.
      findings.push({
        block: `an approval on ${short(call.to)} to ${short(approval.spender)}, which the declaration does not name for that token`,
      })
      continue
    }
    if (matched.has(at)) {
      findings.push({
        block: `${short(call.to)} is approved to ${short(approval.spender)} twice; one declaration is one approval`,
      })
      continue
    }
    matched.add(at)
    if (approval.amount !== declared[at]!.amount) {
      findings.push({
        block: `the plan approves ${approval.amount} to ${short(approval.spender)}, but the declaration says ${declared[at]!.amount}`,
      })
    }
  }
  intent.approvals.forEach((a, i) => {
    if (matched.has(i)) return
    findings.push({
      warn: {
        severity: 'caution' as const,
        code: 'declared_approval_absent',
        message: `the declaration names an approval to ${short(a.spender)} that no call makes`,
      },
    })
  })

  // Native value: declared, held to, and spent once across the batch.
  let allowance = intent.nativeValue ? BigInt(intent.nativeValue) : 0n
  for (const call of calls) {
    if (call.value === '0') continue
    const value = BigInt(call.value)
    if (value <= allowance) {
      allowance -= value
      continue
    }
    findings.push({
      block: intent.nativeValue
        ? `${call.value} wei of native value to ${short(call.to)}, above the ${intent.nativeValue} the declaration allows`
        : `${call.value} wei of native value to ${short(call.to)}, which the declaration does not mention`,
    })
  }

  // The simulation is not optional here, and neither is the trace.
  if (!simulation) {
    findings.push({ block: 'no simulation ran; an agent-authored plan cannot be reviewed on its bytes alone' })
    return findings
  }
  if (!simulation.success) return findings // simulationOutcome already said why
  if (simulation.tracedAssets !== true) {
    findings.push({ block: 'the simulation did not trace balances, so nothing can be said about what leaves' })
    return findings
  }
  const bounds = new Map(intent.expectedChanges.map((c) => [c.asset.toLowerCase(), BigInt(c.maxOut)]))
  for (const change of simulation.assetChanges) {
    const diff = BigInt(change.diff)
    if (diff >= 0n) continue
    const left = -diff
    const name = change.symbol ?? change.assetId
    const max = bounds.get(change.assetId.toLowerCase())
    if (max === undefined) {
      findings.push({ block: `the simulation shows ${name} leaving, which the declaration does not mention` })
    } else if (left > max) {
      findings.push({ block: `the simulation shows ${left} ${name} leaving, above the ${max} the declaration allows` })
    }
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
  simulationOutcome,
  simulationMatchesIntent,
  unverifiedTargets,
  unknownCalldata,
]

const BY_KIND: Readonly<Record<Intent['kind'], readonly Rule[]>> = {
  transfer: [transferRules],
  // One rule set. Everything a swap must satisfy a bridge must too; what
  // differs is only what a source-chain simulation can see.
  swap: [tradeRules],
  bridge: [tradeRules],
  // Supply lands with #79. Until then it fails closed rather than passing on
  // the global rules alone.
  supply: [() => [{ block: 'supply plans cannot be verified yet' }]],
  custom: [customRules],
}

export function verifyPlan(raw: VerifyInput): Verdict {
  // For a custom intent the declaration is the source of truth for spenders.
  // The tool does not repeat it, and could not contradict it.
  const input: VerifyInput =
    raw.intent.kind === 'custom' ? { ...raw, allowedSpenders: raw.intent.approvals.map((a) => a.spender) } : raw
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
