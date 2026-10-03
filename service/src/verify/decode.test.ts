import { type Abi, encodeFunctionData, maxUint160, maxUint256, parseAbi } from 'viem'
import { describe, expect, it } from 'vitest'
import type { Call } from '../core/index.js'
import { KNOWN_ABI } from './abi.js'
import { cloneImplementation, decodeCall, decodeCalls } from './decode.js'
import type { Lookups, SourcifyMatch } from './lookups.js'

/**
 * The lookups answered from memory. What is under test is the order of
 * trust and the shape of the answer, not Sourcify's uptime.
 */
const CHAIN = 'eip155:8453'
const USDC = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913'
const EOA = '0xd8da6bf26964af9d7eed9e03e53415d37aa96045'
const WEIRD = '0x1111111111111111111111111111111111111111'
const SPENDER = '0x2222222222222222222222222222222222222222'

const CUSTOM_ABI = parseAbi(['function stake(uint256 amount, address onBehalfOf)'])

function fake(overrides: Partial<Lookups> = {}): Lookups {
  const contracts: Record<string, SourcifyMatch | null> = {
    [USDC]: { abi: KNOWN_ABI as Abi, name: 'FiatTokenV2_2', match: 'exact_match' },
    [WEIRD]: null,
  }
  return {
    async getCode(_chain, address) {
      return address.toLowerCase() === EOA ? '0x' : '0x6080'
    },
    async sourcify(_chain, address) {
      return contracts[address.toLowerCase()] ?? null
    },
    async fourByte() {
      return []
    },
    async resolveName() {
      return null
    },
    ...overrides,
  }
}

const call = (to: string, data: string, value = '0'): Call => ({
  to: `${CHAIN}:${to}`,
  value,
  data: data.toLowerCase(),
  chainId: CHAIN,
})

describe('decodeCall', () => {
  it('reads a plain value transfer as native, and knows the target is a wallet', async () => {
    const action = await decodeCall(call(EOA, '0x', '1000'), fake())
    expect(action).toMatchObject({
      source: 'native',
      function: 'nativeTransfer()',
      isContract: false,
      verified: false,
      value: '1000',
      args: [],
    })
  })

  it('names a verified contract that receives plain value, and warns on an unverified one', async () => {
    const toUsdc = await decodeCall(call(USDC, '0x', '1'), fake())
    expect(toUsdc).toMatchObject({ source: 'native', isContract: true, verified: true, contractName: 'FiatTokenV2_2' })
    const toWeird = await decodeCall(call(WEIRD, '0x', '1'), fake())
    expect(toWeird).toMatchObject({ source: 'native', isContract: true, verified: false })
  })

  it('decodes an ERC-20 transfer from the shipped ABI, verified by Sourcify', async () => {
    const data = encodeFunctionData({ abi: KNOWN_ABI, functionName: 'transfer', args: [EOA, 500_000_000n] })
    const action = await decodeCall(call(USDC, data), fake())
    expect(action).toMatchObject({
      source: 'abi',
      verified: true,
      isContract: true,
      contractName: 'FiatTokenV2_2',
      function: 'transfer(address,uint256)',
      args: [
        { name: 'to', type: 'address', value: EOA },
        { name: 'amount', type: 'uint256', value: '500000000' },
      ],
    })
    expect(action.approval).toBeUndefined()
  })

  it('still decodes a known selector on an unverified contract, and says so', async () => {
    const data = encodeFunctionData({ abi: KNOWN_ABI, functionName: 'transfer', args: [EOA, 1n] })
    const action = await decodeCall(call(WEIRD, data), fake())
    expect(action.source).toBe('abi')
    expect(action.verified).toBe(false)
    expect(action.contractName).toBeUndefined()
  })

  it('reads an approval, and calls the maximum unlimited', async () => {
    const exact = encodeFunctionData({ abi: KNOWN_ABI, functionName: 'approve', args: [SPENDER, 42n] })
    const infinite = encodeFunctionData({ abi: KNOWN_ABI, functionName: 'approve', args: [SPENDER, maxUint256] })
    expect((await decodeCall(call(USDC, exact), fake())).approval).toEqual({
      spender: `${CHAIN}:${SPENDER}`,
      amount: '42',
    })
    expect((await decodeCall(call(USDC, infinite), fake())).approval).toEqual({
      spender: `${CHAIN}:${SPENDER}`,
      amount: 'unlimited',
    })
  })

  it('reads a Permit2 grant as an approval to its spender, and the uint160 maximum as unlimited', async () => {
    const PERMIT2 = '0x000000000022d473030f116ddee9f6b43ac78ba3'
    const exact = encodeFunctionData({ abi: KNOWN_ABI, functionName: 'approve', args: [USDC, SPENDER, 42n, 1_789_240_982] })
    const forever = encodeFunctionData({ abi: KNOWN_ABI, functionName: 'approve', args: [USDC, SPENDER, maxUint160, 1_789_240_982] })
    const read = await decodeCall(call(PERMIT2, exact), fake())
    expect(read.function).toBe('approve(address,address,uint160,uint48)')
    expect(read.approval).toEqual({ spender: `${CHAIN}:${SPENDER}`, amount: '42' })
    expect((await decodeCall(call(PERMIT2, forever), fake())).approval?.amount).toBe('unlimited')
  })

  it('reads setApprovalForAll(true) as an unlimited approval, and false as none', async () => {
    const on = encodeFunctionData({ abi: KNOWN_ABI, functionName: 'setApprovalForAll', args: [SPENDER, true] })
    const off = encodeFunctionData({ abi: KNOWN_ABI, functionName: 'setApprovalForAll', args: [SPENDER, false] })
    expect((await decodeCall(call(USDC, on), fake())).approval?.amount).toBe('unlimited')
    expect((await decodeCall(call(USDC, off), fake())).approval).toBeUndefined()
  })

  it('falls through to the verified ABI for a function we do not ship', async () => {
    const data = encodeFunctionData({ abi: CUSTOM_ABI, functionName: 'stake', args: [7n, EOA] })
    const lookups = fake({
      async sourcify() {
        return { abi: CUSTOM_ABI as Abi, name: 'Staking', match: 'match' }
      },
    })
    const action = await decodeCall(call(WEIRD, data), lookups)
    expect(action).toMatchObject({
      source: 'sourcify',
      verified: true,
      contractName: 'Staking',
      function: 'stake(uint256,address)',
      args: [
        { name: 'amount', type: 'uint256', value: '7' },
        { name: 'onBehalfOf', type: 'address', value: EOA },
      ],
    })
  })

  it('falls through to 4byte on an unverified contract, and is honest about it', async () => {
    const data = encodeFunctionData({ abi: CUSTOM_ABI, functionName: 'stake', args: [7n, EOA] })
    const lookups = fake({
      async fourByte(selector) {
        expect(selector).toBe(data.slice(0, 10))
        // A collision first, then the real one — the collision fails to decode.
        return ['not_parseable(', 'stake(uint256,address)']
      },
    })
    const action = await decodeCall(call(WEIRD, data), lookups)
    expect(action.source).toBe('4byte')
    expect(action.verified).toBe(false)
    expect(action.function).toBe('stake(uint256,address)')
  })

  /** vitalik.eth on Base has a 7702 delegation; a wallet with code is still a wallet. */
  it('reads an EIP-7702 delegated wallet as a wallet, not a contract', async () => {
    const lookups = fake({
      async getCode() {
        return `0xef0100${'ab'.repeat(20)}`
      },
    })
    const action = await decodeCall(call(EOA, '0x', '1'), lookups)
    expect(action.isContract).toBe(false)
  })

  /**
   * The case that made every swap read "could not be decoded": LI.FI's router
   * is an EIP-2535 diamond, Sourcify verifies the proxy, and the proxy's ABI
   * carries no functions at all — while 4byte knows the selector perfectly
   * well. A verified ABI that cannot speak for any function is not evidence
   * about this call.
   */
  it('asks 4byte about a verified proxy whose ABI has no functions', async () => {
    const data = encodeFunctionData({ abi: CUSTOM_ABI, functionName: 'stake', args: [7n, EOA] })
    const lookups = fake({
      async sourcify() {
        // A diamond façade: events and a fallback, and nothing callable.
        return {
          abi: [{ type: 'fallback', stateMutability: 'payable' }, { type: 'event', name: 'DiamondCut', inputs: [] }] as unknown as Abi,
          name: 'LiFiDiamond',
          match: 'match',
        }
      },
      async fourByte() {
        return ['stake(uint256,address)']
      },
    })
    const action = await decodeCall(call(WEIRD, data), lookups)
    expect(action).toMatchObject({
      source: '4byte',
      // Still a verified contract; only the name came from elsewhere.
      verified: true,
      contractName: 'LiFiDiamond',
      function: 'stake(uint256,address)',
    })
  })

  it('still says unknown for a proxy whose selector nobody knows', async () => {
    const lookups = fake({
      async sourcify() {
        return { abi: [{ type: 'fallback', stateMutability: 'payable' }] as unknown as Abi, name: 'LiFiDiamond', match: 'match' }
      },
    })
    const action = await decodeCall(call(WEIRD, '0xdeadbeef'), lookups)
    expect(action).toMatchObject({ source: 'unknown', function: 'unknown', verified: true, contractName: 'LiFiDiamond' })
  })

  it('does not ask 4byte about a verified contract whose ABI lacks the selector', async () => {
    let asked = false
    const lookups = fake({
      async sourcify() {
        return { abi: CUSTOM_ABI as Abi, name: 'Staking', match: 'match' }
      },
      async fourByte() {
        asked = true
        return ['CodeIsLawZ95677371()']
      },
    })
    const action = await decodeCall(call(WEIRD, '0xdeadbeef'), lookups)
    expect(asked).toBe(false)
    expect(action).toMatchObject({ source: 'unknown', function: 'unknown', verified: true, contractName: 'Staking' })
  })

  it('marks an unknown selector unknown rather than dropping the call', async () => {
    const action = await decodeCall(call(WEIRD, '0xdeadbeef00000000'), fake())
    expect(action).toMatchObject({ source: 'unknown', function: 'unknown', args: [], verified: false })
  })

  it('does not ask Sourcify about a wallet address', async () => {
    let asked = false
    const lookups = fake({
      async sourcify() {
        asked = true
        return null
      },
    })
    const action = await decodeCall(call(EOA, '0xa9059cbb'), lookups)
    expect(asked).toBe(false)
    expect(action.isContract).toBe(false)
  })

  it('refuses to guess when the chain cannot be read', async () => {
    const lookups = fake({
      async getCode() {
        throw new Error('rpc down')
      },
    })
    await expect(decodeCall(call(EOA, '0x', '1'), lookups)).rejects.toThrow('rpc down')
  })
})

describe('decodeCalls', () => {
  it('keeps one action per call, in order', async () => {
    const transfer = encodeFunctionData({ abi: KNOWN_ABI, functionName: 'transfer', args: [EOA, 1n] })
    const actions = await decodeCalls([call(EOA, '0x', '5'), call(USDC, transfer)], fake())
    expect(actions.map((a) => a.source)).toEqual(['native', 'abi'])
  })
})

/**
 * A factory-made account: an EIP-1167 clone with nothing verified at its own
 * address, running an implementation that is. The real case was a strategy
 * account on Base whose `pause()` read as a 4byte guess on an unverified target.
 */
describe('a minimal-proxy clone', () => {
  const CLONE = '0x2cf2ea13b2c22589c82879654b70e2571e42e158'
  const IMPL = '0xf420ad09e466f76a2f52dfa35c6eb411764c9229'
  const UNPUBLISHED = '0x5555555555555555555555555555555555555555'
  const STRATEGY_ABI = parseAbi(['function pause()', 'function deposit(uint256 amount)'])
  const proxyOf = (impl: string) => `0x363d3d373d3d3d363d73${impl.slice(2)}5af43d82803e903d91602b57fd5bf3`
  const pause = encodeFunctionData({ abi: STRATEGY_ABI, functionName: 'pause' })

  const lookups = (impl: string) =>
    fake({
      async getCode(_chain, address) {
        return address.toLowerCase() === CLONE ? proxyOf(impl) : '0x6080'
      },
      async sourcify(_chain, address) {
        return address.toLowerCase() === IMPL ? { abi: STRATEGY_ABI, name: 'UserStrategyAccount', match: 'exact_match' } : null
      },
      async fourByte() {
        return ['pause()']
      },
    })

  it('reads the call from the implementation\'s source and names both', async () => {
    const action = await decodeCall(call(CLONE, pause), lookups(IMPL))
    expect(action).toMatchObject({
      target: `${CHAIN}:${CLONE}`,
      implementation: `${CHAIN}:${IMPL}`,
      source: 'sourcify',
      verified: true,
      contractName: 'UserStrategyAccount',
      function: 'pause()',
    })
  })

  it('stays unverified when the implementation is unpublished too', async () => {
    const action = await decodeCall(call(CLONE, pause), lookups(UNPUBLISHED))
    expect(action).toMatchObject({ implementation: `${CHAIN}:${UNPUBLISHED}`, verified: false, source: '4byte' })
  })

  it('leaves a contract that is not a clone alone', async () => {
    const action = await decodeCall(call(WEIRD, pause), lookups(IMPL))
    expect(action.implementation).toBeUndefined()
    expect(action.verified).toBe(false)
  })

  it('matches the exact 45 bytes and nothing that resembles them', () => {
    const exact = proxyOf(IMPL)
    expect(cloneImplementation(exact)).toBe(IMPL)
    expect(cloneImplementation(exact.toUpperCase().replace('0X', '0x'))).toBe(IMPL)
    // One byte more, one byte less, an altered opcode, a 19-byte vanity push.
    expect(cloneImplementation(`${exact}00`)).toBeNull()
    expect(cloneImplementation(exact.slice(0, -2))).toBeNull()
    expect(cloneImplementation(exact.replace('5af4', '5af1'))).toBeNull()
    expect(cloneImplementation(`0x363d3d373d3d3d363d72${IMPL.slice(4)}5af43d82803e903d91602b57fd5bf3`)).toBeNull()
    expect(cloneImplementation('0x6080')).toBeNull()
  })
})
