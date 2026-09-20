import {
  type Abi,
  type AbiFunction,
  type Hex,
  decodeFunctionData,
  maxUint160,
  maxUint256,
  parseAbiItem,
  toFunctionSelector,
  toFunctionSignature,
} from 'viem'
import { type Call, type DecodedAction, accountOn, parseAccountId, parseChainId } from '../core/index.js'
import { KNOWN_BY_SELECTOR, PERMIT2_APPROVE } from './abi.js'
import type { Lookups } from './lookups.js'

/**
 * Calldata into something a person can check.
 *
 * Order of trust: ABIs we ship, then verified source from Sourcify, then a
 * signature from 4byte, then "unknown" with the raw bytes left for the review
 * page to show with a warning. Every action says which of those it came from,
 * and whether the target is verified at all — a decoded name from 4byte on an
 * unverified contract is a guess, and the page should say so.
 */

type DecodedArgs = readonly unknown[] | undefined

function stringify(value: unknown): string {
  if (typeof value === 'bigint') return value.toString()
  if (typeof value === 'string') return value.startsWith('0x') ? value.toLowerCase() : value
  if (typeof value === 'boolean' || typeof value === 'number') return String(value)
  return JSON.stringify(value, (_, v: unknown) => (typeof v === 'bigint' ? v.toString() : v))
}

function argsOf(item: AbiFunction, values: DecodedArgs) {
  return item.inputs.map((input, i) => ({
    name: input.name ?? `arg${i}`,
    type: input.type,
    value: stringify(values?.[i]),
  }))
}

function tryDecode(abi: Abi, data: Hex): { item: AbiFunction; args: DecodedArgs } | null {
  try {
    const { functionName, args } = decodeFunctionData({ abi, data })
    const selector = data.slice(0, 10)
    const item = abi.find(
      (f): f is AbiFunction =>
        f.type === 'function' && f.name === functionName && toFunctionSelector(f) === selector,
    )
    return item ? { item, args } : null
  } catch {
    return null
  }
}

/**
 * An approval, if this is one. Unlimited means the maximum uint256, which is
 * what every "infinite approval" button sends; anything smaller is a number a
 * person can read and judge.
 */
function approvalOf(chainId: string, item: AbiFunction, args: DecodedArgs): DecodedAction['approval'] {
  const chain = parseChainId(chainId)
  const spender = (i: number) => accountOn(chain, String(args?.[i]))
  switch (toFunctionSignature(item)) {
    case 'approve(address,uint256)':
    case 'increaseAllowance(address,uint256)': {
      const amount = args?.[1] as bigint
      return { spender: spender(0), amount: amount === maxUint256 ? 'unlimited' : amount.toString() }
    }
    case 'setApprovalForAll(address,bool)':
      return args?.[1] === true ? { spender: spender(0), amount: 'unlimited' } : undefined
    case PERMIT2_APPROVE: {
      const amount = args?.[2] as bigint
      return { spender: spender(1), amount: amount === maxUint160 ? 'unlimited' : amount.toString() }
    }
    default:
      return undefined
  }
}

/**
 * An EIP-7702 delegation designator: 0xef0100 followed by the delegate's
 * address. A wallet that has one has code, but it is still a wallet — the
 * person's own account, delegated to a known implementation — and reading it
 * as an unverified contract would warn on every 7702 recipient.
 */
const DELEGATION = /^0xef0100[0-9a-f]{40}$/i

function hasContractCode(code: string): boolean {
  return code.length > 2 && code !== '0x0' && !DELEGATION.test(code)
}

export async function decodeCall(call: Call, lookups: Lookups): Promise<DecodedAction> {
  const { address } = parseAccountId(call.to)
  const code = await lookups.getCode(call.chainId, address)
  const isContract = hasContractCode(code)
  const base = { target: call.to, isContract, value: call.value }

  // Verification status is about the target, not the calldata: value sent to
  // a contract with no data still lands in code someone may or may not have
  // published, and the page should name it either way.
  const source = isContract ? await lookups.sourcify(call.chainId, address) : null
  const verified = source !== null
  const named = source?.name === undefined ? {} : { contractName: source.name }

  if (call.data === '0x' || call.data === '') {
    return { ...base, ...named, source: 'native', verified, function: 'nativeTransfer()', args: [] }
  }

  const data = call.data as Hex
  const selector = data.slice(0, 10)

  const finish = (
    from: DecodedAction['source'],
    decoded: { item: AbiFunction; args: DecodedArgs },
  ): DecodedAction => {
    const approval = approvalOf(call.chainId, decoded.item, decoded.args)
    return {
      ...base,
      ...named,
      source: from,
      verified,
      function: toFunctionSignature(decoded.item),
      args: argsOf(decoded.item, decoded.args),
      ...(approval ? { approval } : {}),
    }
  }

  const known = KNOWN_BY_SELECTOR.get(selector)
  if (known) {
    const decoded = tryDecode([known], data)
    if (decoded) return finish('abi', decoded)
  }

  if (source) {
    const decoded = tryDecode(source.abi, data)
    if (decoded) return finish('sourcify', decoded)
    /**
     * Verified source that has functions, but not this one: the call hits a
     * fallback, or nothing. A 4byte name here would be a collision dressed
     * as a decoding, and worse than "unknown" because it looks like an
     * answer. So stop.
     *
     * Unless the verified ABI has no functions at all, which is a proxy
     * façade rather than a contract that lacks the selector. EIP-2535
     * diamonds keep every callable function in facets, and LI.FI's router is
     * one: Sourcify verifies `LiFiDiamond`, whose ABI carries fourteen
     * entries and zero functions, while 4byte knows the selector perfectly
     * well. Stopping there made every swap read "could not be decoded" on
     * the review page, which is the one page where the function's name is
     * the thing being checked.
     */
    if (hasFunctions(source.abi)) {
      return { ...base, ...named, source: 'unknown', verified, function: 'unknown', args: [] }
    }
  }

  for (const signature of await lookups.fourByte(selector)) {
    try {
      const item = parseAbiItem(`function ${signature}`) as AbiFunction
      const decoded = tryDecode([item], data)
      if (decoded) return finish('4byte', decoded)
    } catch {
      // A signature 4byte holds that viem cannot parse is not one we can use.
    }
  }

  return { ...base, ...named, source: 'unknown', verified, function: 'unknown', args: [] }
}

/**
 * Whether a verified ABI actually describes any callable function.
 *
 * A proxy's does not. That is the difference between "this contract has no
 * such function" and "this contract's ABI cannot speak for its functions",
 * and only the first is evidence about the call.
 */
function hasFunctions(abi: Abi): boolean {
  return abi.some((entry) => entry.type === 'function')
}

/** One action per call, in order. The policy layer relies on that pairing. */
export async function decodeCalls(calls: readonly Call[], lookups: Lookups): Promise<DecodedAction[]> {
  return Promise.all(calls.map((call) => decodeCall(call, lookups)))
}
