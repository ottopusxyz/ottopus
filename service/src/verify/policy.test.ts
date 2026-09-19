import { encodeFunctionData, maxUint256 } from 'viem'
import { describe, expect, it } from 'vitest'
import type { AssetDelta, Call, DecodedAction, Intent, Simulation } from '../core/index.js'
import { KNOWN_ABI } from './abi.js'
import { decodeCalls } from './decode.js'
import type { Lookups } from './lookups.js'
import { blockWarnings, verifyPlan } from './policy.js'

/**
 * Decoding is real (with lookups answered from memory), so a rule is tested
 * against what the decoder actually produces rather than a hand-written
 * action that might drift from it.
 */
const CHAIN = 'eip155:8453'
const USDC = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913'
const ALICE = '0xd8da6bf26964af9d7eed9e03e53415d37aa96045'
const MALLORY = '0x9999999999999999999999999999999999999999'
const ROUTER = '0x2222222222222222222222222222222222222222'

const lookups: Lookups = {
  async getCode(_c, address) {
    return [USDC, ROUTER, MALLORY].includes(address.toLowerCase()) ? '0x6080' : '0x'
  },
  async sourcify(_c, address) {
    return address.toLowerCase() === USDC ? { abi: KNOWN_ABI, name: 'FiatTokenV2_2', match: 'exact_match' } : null
  },
  async fourByte() {
    return []
  },
  async resolveName() {
    return null
  },
}

const call = (to: string, data: string, value = '0'): Call => ({
  to: `${CHAIN}:${to}`,
  value,
  data: data.toLowerCase(),
  chainId: CHAIN,
})

const nativeIntent: Intent = { kind: 'transfer', asset: `${CHAIN}/slip44:60`, amount: '1000', to: `${CHAIN}:${ALICE}` }
const usdcIntent: Intent = { kind: 'transfer', asset: `${CHAIN}/erc20:${USDC}`, amount: '500000000', to: `${CHAIN}:${ALICE}` }

const transfer = (to: string, amount: bigint) =>
  encodeFunctionData({ abi: KNOWN_ABI, functionName: 'transfer', args: [to, amount] })

async function verify(
  intent: Intent,
  calls: Call[],
  allowedSpenders?: string[],
  simulation?: Simulation | null,
  quote?: { expectedOut?: string; minOut?: string; nativeFee?: string | null },
) {
  const decodedActions = await decodeCalls(calls, lookups)
  return verifyPlan({
    intent,
    calls,
    decodedActions,
    ...(allowedSpenders ? { allowedSpenders } : {}),
    ...(simulation !== undefined ? { simulation } : {}),
    ...(quote ? { quote } : {}),
  })
}

/** A simulation that observed exactly what was asked, unless a test says otherwise. */
function ran(over: Partial<Simulation> = {}): Simulation {
  return {
    provider: 'eth_simulateV1',
    chainId: CHAIN,
    blockNumber: '51119499',
    success: true,
    assetChanges: [delta(`${CHAIN}/erc20:${USDC}`, '-500000000', 'USDC', 6)],
    gasUsed: '44831',
    gasUsd: '0.01',
    resultHash: 'a'.repeat(64),
    ranAt: '2026-09-10T12:00:00.000Z',
    ...over,
  }
}

function delta(assetId: string, diff: string, symbol: string | null = null, decimals: number | null = null): AssetDelta {
  const post = diff.startsWith('-') ? '0' : diff
  return { assetId, symbol, decimals, diff, pre: diff.startsWith('-') ? diff.slice(1) : '0', post }
}

describe('a clean transfer', () => {
  it('passes as native value to the recipient', async () => {
    const verdict = await verify(nativeIntent, [call(ALICE, '0x', '1000')])
    expect(verdict).toEqual({ ok: true, warnings: [] })
  })

  it('passes as an ERC-20 transfer of exactly the amount to exactly the recipient', async () => {
    const verdict = await verify(usdcIntent, [call(USDC, transfer(ALICE, 500_000_000n))])
    expect(verdict).toEqual({ ok: true, warnings: [] })
  })
})

describe('a transfer that is not what it says', () => {
  it('blocks a swapped recipient', async () => {
    const verdict = await verify(usdcIntent, [call(USDC, transfer(MALLORY, 500_000_000n))])
    expect(verdict.ok).toBe(false)
    expect(!verdict.ok && verdict.reasons.join()).toMatch(/goes to 0x9999…9999, not to/)
  })

  it('blocks a larger amount, and a smaller one', async () => {
    const more = await verify(usdcIntent, [call(USDC, transfer(ALICE, 500_000_001n))])
    const less = await verify(usdcIntent, [call(USDC, transfer(ALICE, 1n))])
    expect(!more.ok && more.reasons.join()).toMatch(/moves 500000001, but the intent says 500000000/)
    expect(less.ok).toBe(false)
  })

  it('blocks a native transfer to the wrong address or of the wrong value', async () => {
    const wrongTo = await verify(nativeIntent, [call(MALLORY, '0x', '1000')])
    const wrongValue = await verify(nativeIntent, [call(ALICE, '0x', '999')])
    expect(!wrongTo.ok && wrongTo.reasons.join()).toMatch(/sends to 0x9999…9999/)
    expect(!wrongValue.ok && wrongValue.reasons.join()).toMatch(/sends 999 wei, but the intent says 1000/)
  })

  it('blocks a smuggled second call, whatever it is', async () => {
    const verdict = await verify(usdcIntent, [
      call(USDC, transfer(ALICE, 500_000_000n)),
      call(USDC, transfer(MALLORY, 1n)),
    ])
    expect(!verdict.ok && verdict.reasons).toEqual(['a transfer is one call; this plan has 2'])
  })

  it('blocks a call to the wrong contract', async () => {
    const verdict = await verify(usdcIntent, [call(MALLORY, transfer(ALICE, 500_000_000n))])
    expect(!verdict.ok && verdict.reasons.join()).toMatch(/targets 0x9999…9999, not the token/)
  })

  it('blocks a different function on the right token', async () => {
    const approve = encodeFunctionData({ abi: KNOWN_ABI, functionName: 'approve', args: [ALICE, 500_000_000n] })
    const verdict = await verify(usdcIntent, [call(USDC, approve)])
    expect(!verdict.ok && verdict.reasons.join()).toMatch(/is approve\(address,uint256\), not transfer/)
  })

  it('blocks native value riding along with a token transfer', async () => {
    const verdict = await verify(usdcIntent, [call(USDC, transfer(ALICE, 500_000_000n), '1')])
    expect(!verdict.ok && verdict.reasons.join()).toMatch(/1 wei of native value .* did not ask for/)
  })

  it('blocks calldata on a native transfer', async () => {
    const verdict = await verify(nativeIntent, [call(ALICE, '0xdeadbeef', '1000')])
    expect(!verdict.ok && verdict.reasons.join()).toMatch(/carries calldata/)
  })

  it('blocks a token that is not a contract on this chain', async () => {
    const intent: Intent = { ...usdcIntent, asset: `${CHAIN}/erc20:${ALICE}` }
    const verdict = await verify(intent, [call(ALICE, transfer(ALICE, 500_000_000n))])
    expect(!verdict.ok && verdict.reasons.join()).toMatch(/has no code on Base/)
  })
})

describe('the calldata is what is checked, not the evidence', () => {
  /**
   * Decode an honest transfer, then swap the calldata underneath it. The
   * evidence still says "10 to Alice"; the bytes say "100000 to Mallory".
   * A policy that read the evidence would pass this.
   */
  it('blocks calldata that the decoded action does not describe', async () => {
    const honest = [call(USDC, transfer(ALICE, 10n))]
    const decodedActions = await decodeCalls(honest, lookups)
    const intent: Intent = { ...usdcIntent, amount: '10' }
    expect(verifyPlan({ intent, calls: honest, decodedActions }).ok).toBe(true)

    const swapped = [call(USDC, transfer(MALLORY, 100_000n))]
    const verdict = verifyPlan({ intent, calls: swapped, decodedActions })
    expect(verdict.ok).toBe(false)
    expect(!verdict.ok && verdict.reasons.join('\n')).toMatch(/decoded action 1 shows to as 0xd8da6bf2.*but the calldata says otherwise/)
    expect(!verdict.ok && verdict.reasons.join('\n')).toMatch(/goes to 0x9999…9999/)
    expect(!verdict.ok && verdict.reasons.join('\n')).toMatch(/moves 100000, but the intent says 10/)
  })

  it('blocks evidence that names a different function than the bytes', async () => {
    const calls = [call(USDC, transfer(ALICE, 500_000_000n))]
    const [action] = await decodeCalls(calls, lookups)
    const forged = { ...action!, function: 'approve(address,uint256)' }
    const verdict = verifyPlan({ intent: usdcIntent, calls, decodedActions: [forged] })
    expect(!verdict.ok && verdict.reasons.join()).toMatch(/is approve\(address,uint256\), but the calldata is transfer/)
  })

  it('blocks evidence that hides an approval the bytes carry', async () => {
    const calls = [call(USDC, encodeFunctionData({ abi: KNOWN_ABI, functionName: 'approve', args: [MALLORY, maxUint256] }))]
    const [action] = await decodeCalls(calls, lookups)
    const { approval: _hidden, ...laundered } = action!
    const verdict = verifyPlan({ intent: usdcIntent, calls, decodedActions: [laundered] })
    expect(!verdict.ok && verdict.reasons.join()).toMatch(/unlimited approval to 0x9999…9999/)
  })

  it('blocks evidence whose target or value differs from the call', async () => {
    const calls = [call(ALICE, '0x', '1000')]
    const [action] = await decodeCalls(calls, lookups)
    const wrongTarget = verifyPlan({ intent: nativeIntent, calls, decodedActions: [{ ...action!, target: `${CHAIN}:${MALLORY}` }] })
    const wrongValue = verifyPlan({ intent: nativeIntent, calls, decodedActions: [{ ...action!, value: '1' }] })
    expect(!wrongTarget.ok && wrongTarget.reasons.join()).toMatch(/describes 0x9999…9999, but the call targets/)
    expect(!wrongValue.ok && wrongValue.reasons.join()).toMatch(/says 1 wei, but the call carries 1000/)
  })
})

describe('global rules', () => {
  it('blocks an unlimited approval even to a named spender', async () => {
    const approve = encodeFunctionData({ abi: KNOWN_ABI, functionName: 'approve', args: [ROUTER, maxUint256] })
    const verdict = await verify(usdcIntent, [call(USDC, approve)], [`${CHAIN}:${ROUTER}`])
    expect(!verdict.ok && verdict.reasons.join()).toMatch(/unlimited approval to 0x2222…2222/)
  })

  it('blocks an approval to a spender the intent does not name', async () => {
    const approve = encodeFunctionData({ abi: KNOWN_ABI, functionName: 'approve', args: [ROUTER, 5n] })
    const verdict = await verify(usdcIntent, [call(USDC, approve)])
    expect(!verdict.ok && verdict.reasons.join()).toMatch(/approval to 0x2222…2222, which the intent does not name/)
  })

  it('blocks anything that reads as a delegatecall', async () => {
    const calls = [call(USDC, transfer(ALICE, 500_000_000n))]
    const decodedActions: DecodedAction[] = [
      {
        target: calls[0]!.to,
        isContract: true,
        source: '4byte',
        verified: false,
        function: 'delegateCall(address,bytes)',
        args: [],
        value: '0',
      },
    ]
    const verdict = verifyPlan({ intent: usdcIntent, calls, decodedActions })
    expect(!verdict.ok && verdict.reasons.join()).toMatch(/is a delegatecall, which is never allowed/)
  })

  it('blocks a plan whose decoding does not pair with its calls', () => {
    const verdict = verifyPlan({ intent: nativeIntent, calls: [call(ALICE, '0x', '1000')], decodedActions: [] })
    expect(!verdict.ok && verdict.reasons).toEqual(['1 calls but 0 decoded actions; the plan cannot be checked'])
  })

  it('warns, not blocks, on an unverified contract that otherwise does the right thing', async () => {
    const intent: Intent = { ...usdcIntent, asset: `${CHAIN}/erc20:${MALLORY}` }
    const verdict = await verify(intent, [call(MALLORY, transfer(ALICE, 500_000_000n))])
    expect(verdict.ok).toBe(true)
    expect(verdict.warnings.map((w) => w.code)).toEqual(['unverified_contract'])
  })

  it('fails closed for kinds it has no rules for yet', () => {
    const intent = { kind: 'supply', asset: `${CHAIN}/erc20:${USDC}`, amount: '1', protocol: 'aave-v3' } as Intent
    const verdict = verifyPlan({ intent, calls: [], decodedActions: [] })
    expect(!verdict.ok && verdict.reasons).toEqual(['supply plans cannot be verified yet'])
  })
})

describe('blockWarnings', () => {
  it('turns reasons into block-severity warnings ahead of the cautions', async () => {
    const intent: Intent = { ...usdcIntent, asset: `${CHAIN}/erc20:${MALLORY}` }
    const verdict = await verify(intent, [call(MALLORY, transfer(MALLORY, 1n))])
    const warnings = blockWarnings(verdict)
    expect(warnings[0]!.severity).toBe('block')
    expect(warnings.at(-1)!.code).toBe('unverified_contract')
  })
})

describe('what the simulation observed', () => {
  const usdcCall = () => [call(USDC, transfer(ALICE, 500_000_000n))]

  it('is not required: a plan on a chain nobody simulates still passes', async () => {
    expect(await verify(usdcIntent, usdcCall(), undefined, null)).toEqual({ ok: true, warnings: [] })
  })

  it('passes when the observed movement is exactly what the plan says', async () => {
    expect(await verify(usdcIntent, usdcCall(), undefined, ran())).toEqual({ ok: true, warnings: [] })
  })

  it('blocks a simulation that failed, and repeats the chain’s reason', async () => {
    const verdict = await verify(usdcIntent, usdcCall(), undefined, ran({
      success: false,
      failedCall: 1,
      revertReason: 'ERC20: transfer amount exceeds balance',
      assetChanges: [],
    }))
    expect(verdict.ok).toBe(false)
    expect(verdict.ok === false && verdict.reasons).toContain(
      'the simulation failed on call 1: ERC20: transfer amount exceeds balance',
    )
  })

  /**
   * The rule the decoder cannot enforce. The calldata says transfer(alice,
   * 500 USDC) and reads correctly; the token's own code takes a second asset
   * on the way out. Only running it finds that.
   */
  it('blocks a second asset leaving that the plan never mentioned', async () => {
    const verdict = await verify(usdcIntent, usdcCall(), undefined, ran({
      assetChanges: [
        delta(`${CHAIN}/erc20:${USDC}`, '-500000000', 'USDC', 6),
        delta(`${CHAIN}/erc20:${ROUTER}`, '-9000000000000000000', 'WETH', 18),
      ],
    }))
    expect(verdict.ok).toBe(false)
    expect(verdict.ok === false && verdict.reasons).toContain(
      'the simulation shows WETH leaving the wallet as well, which the plan does not mention',
    )
  })

  it('lets an asset arriving pass without comment', async () => {
    const verdict = await verify(usdcIntent, usdcCall(), undefined, ran({
      assetChanges: [
        delta(`${CHAIN}/erc20:${USDC}`, '-500000000', 'USDC', 6),
        delta(`${CHAIN}/slip44:60`, '5000', 'ETH', 18),
      ],
    }))
    expect(verdict).toEqual({ ok: true, warnings: [] })
  })

  it('blocks more of the asset leaving than the plan promised', async () => {
    const verdict = await verify(usdcIntent, usdcCall(), undefined, ran({
      assetChanges: [delta(`${CHAIN}/erc20:${USDC}`, '-500000001', 'USDC', 6)],
    }))
    expect(verdict.ok).toBe(false)
    expect(verdict.ok === false && verdict.reasons).toContain(
      'the simulation shows 500000001 leaving, but the plan says 500000000',
    )
  })

  /** Fee-on-transfer tokens move less than asked. Nobody is harmed, so it warns. */
  it('only warns when less leaves than the plan promised', async () => {
    const verdict = await verify(usdcIntent, usdcCall(), undefined, ran({
      assetChanges: [delta(`${CHAIN}/erc20:${USDC}`, '-499000000', 'USDC', 6)],
    }))
    expect(verdict.ok).toBe(true)
    expect(verdict.warnings.map((w) => w.code)).toEqual(['simulation_amount_below_plan'])
  })

  it('warns when the traced balances never mention the asset being sent', async () => {
    const verdict = await verify(usdcIntent, usdcCall(), undefined, ran({
      assetChanges: [delta(`${CHAIN}/slip44:60`, '-21000', 'ETH', 18)],
    }))
    // The unmentioned outgoing asset blocks; the missing source asset warns.
    expect(verdict.ok).toBe(false)
    expect(verdict.warnings.map((w) => w.code)).toContain('simulation_no_source_change')
  })

  it('says nothing about balances it did not trace', async () => {
    expect(await verify(usdcIntent, usdcCall(), undefined, ran({ assetChanges: [] }))).toEqual({
      ok: true,
      warnings: [],
    })
  })
})

describe('a swap', () => {
  const ROUTER_ID = `${CHAIN}:${ROUTER}`
  const nativeIn: Intent = { kind: 'swap', from: `${CHAIN}/slip44:60`, to: `${CHAIN}/erc20:${USDC}`, amountIn: '1000' }
  const tokenIn: Intent = { kind: 'swap', from: `${CHAIN}/erc20:${USDC}`, to: `${CHAIN}/slip44:60`, amountIn: '500000000' }
  const approve = (spender: string, amount: bigint) =>
    encodeFunctionData({ abi: KNOWN_ABI, functionName: 'approve', args: [spender, amount] })
  /** A router's own calldata is nobody's to decode; the shape is what is checked. */
  const swapCall = (value = '0') => call(ROUTER, '0xdeadbeef', value)
  const floor = { expectedOut: '1000000', minOut: '995000' }
  const ok = (intent: Intent, calls: Call[], q = floor) => verify(intent, calls, [ROUTER_ID], undefined, q)

  it('passes as native value to the router, with no approval', async () => {
    const verdict = await ok(nativeIn, [swapCall('1000')])
    expect(verdict.ok, JSON.stringify(!verdict.ok && verdict.reasons)).toBe(true)
  })

  it('passes as an exact approval to the router, then the router call', async () => {
    const verdict = await ok(tokenIn, [call(USDC, approve(ROUTER, 500_000_000n)), swapCall()])
    expect(verdict.ok, JSON.stringify(!verdict.ok && verdict.reasons)).toBe(true)
  })

  it('blocks approving more than it swaps', async () => {
    const verdict = await ok(tokenIn, [call(USDC, approve(ROUTER, 600_000_000n)), swapCall()])
    expect(verdict.ok === false && verdict.reasons).toContain(
      'the plan approves 600000000 but the intent spends 500000000; a trade approves exactly what it spends',
    )
  })

  it('blocks an unlimited approval even to the right router', async () => {
    const verdict = await ok(tokenIn, [call(USDC, approve(ROUTER, maxUint256)), swapCall()])
    expect(verdict.ok).toBe(false)
    expect((verdict.ok === false && verdict.reasons).toString()).toContain('a trade approves exactly what it spends')
  })

  /** The shape a drain takes: approve one address, call another. */
  it('blocks an approval to somewhere other than the contract it calls', async () => {
    const verdict = await ok(tokenIn, [call(USDC, approve(MALLORY, 500_000_000n)), swapCall()])
    expect(verdict.ok === false && verdict.reasons).toContain(
      `the approval lets 0x9999…9999 spend, but the call goes to 0x2222…2222`,
    )
  })

  it('blocks an approval on a token other than the one being swapped', async () => {
    const verdict = await ok(tokenIn, [call(MALLORY, approve(ROUTER, 500_000_000n)), swapCall()])
    expect(verdict.ok === false && verdict.reasons).toContain(
      'the approval is on 0x9999…9999, not on the token being spent',
    )
  })

  it('blocks a third call', async () => {
    const verdict = await ok(tokenIn, [call(USDC, approve(ROUTER, 500_000_000n)), swapCall(), swapCall()])
    expect(verdict.ok === false && verdict.reasons).toContain(
      'a trade is one router call, with an approval at most; this plan has 3',
    )
  })

  it('blocks an approval when the input is the chain’s own currency', async () => {
    const verdict = await ok(nativeIn, [call(USDC, approve(ROUTER, 1000n)), swapCall('1000')])
    expect((verdict.ok === false && verdict.reasons).toString()).toContain('cannot be approved')
  })

  it('blocks native value that does not match the intent', async () => {
    const verdict = await ok(nativeIn, [swapCall('999')])
    expect(verdict.ok === false && verdict.reasons).toContain('the call sends 999 wei, but the intent says 1000')
  })

  describe('the floor the page promises', () => {
    it('is required', async () => {
      const verdict = await verify(nativeIn, [swapCall('1000')], [ROUTER_ID], undefined, {})
      expect(verdict.ok === false && verdict.reasons).toContain(
        'the quote gives no minimum received; a trade cannot be reviewed without a floor',
      )
    })

    it('cannot be zero', async () => {
      const verdict = await ok(nativeIn, [swapCall('1000')], { expectedOut: '10', minOut: '0' })
      expect(verdict.ok === false && verdict.reasons).toContain('the quote’s minimum received is zero; that is not a floor')
    })

    it('cannot exceed what the route expects', async () => {
      const verdict = await ok(nativeIn, [swapCall('1000')], { expectedOut: '900', minOut: '1000' })
      expect(verdict.ok === false && verdict.reasons).toContain('the quote promises at least 1000 but expects only 900')
    })
  })

  /** The one check that tells a promised floor from a kept one. */
  it('blocks a simulation that received less than the quote promised', async () => {
    const sim: Simulation = {
      provider: 'eth_simulateV1',
      chainId: CHAIN,
      blockNumber: '1',
      success: true,
      assetChanges: [
        delta(`${CHAIN}/slip44:60`, '-1000', 'ETH', 18),
        delta(`${CHAIN}/erc20:${USDC}`, '990000', 'USDC', 6),
      ],
      gasUsed: '120000',
      gasUsd: '0.02',
      resultHash: 'c'.repeat(64),
      ranAt: '2026-09-10T12:00:00.000Z',
    }
    const verdict = await verify(nativeIn, [swapCall('1000')], [ROUTER_ID], sim, floor)
    expect(verdict.ok === false && verdict.reasons).toContain(
      'the simulation received 990000, below the 995000 the quote promised',
    )
  })
})

describe('a bridge', () => {
  const ROUTER_ID = `${CHAIN}:${ROUTER}`
  const crossing: Intent = {
    kind: 'bridge',
    from: `${CHAIN}/erc20:${USDC}`,
    to: 'eip155:1/slip44:60',
    amountIn: '500000000',
  }
  const approve = (spender: string, amount: bigint) =>
    encodeFunctionData({ abi: KNOWN_ABI, functionName: 'approve', args: [spender, amount] })
  const calls = () => [call(USDC, approve(ROUTER, 500_000_000n)), call(ROUTER, '0xdeadbeef')]
  const floor = { expectedOut: '27639745518623', minOut: '27501546791030' }

  it('passes the same checks a swap does', async () => {
    const verdict = await verify(crossing, calls(), [ROUTER_ID], undefined, floor)
    expect(verdict.ok, JSON.stringify(!verdict.ok && verdict.reasons)).toBe(true)
  })

  it('is held to the same exact approval', async () => {
    const verdict = await verify(
      crossing,
      [call(USDC, approve(ROUTER, maxUint256)), call(ROUTER, '0xdeadbeef')],
      [ROUTER_ID],
      undefined,
      floor,
    )
    expect((verdict.ok === false && verdict.reasons).toString()).toContain('a trade approves exactly what it spends')
  })

  /**
   * The one rule that cannot apply. The output arrives on another chain
   * minutes later, so a source-chain run seeing nothing arrive proves
   * nothing — blocking on it would refuse every bridge.
   */
  it('is not blocked for an arrival its own chain could never observe', async () => {
    const sim: Simulation = {
      provider: 'eth_simulateV1',
      chainId: CHAIN,
      blockNumber: '1',
      success: true,
      // The input left; nothing came back, because it comes back elsewhere.
      assetChanges: [delta(`${CHAIN}/erc20:${USDC}`, '-500000000', 'USDC', 6)],
      gasUsed: '210000',
      gasUsd: '0.04',
      resultHash: 'd'.repeat(64),
      ranAt: '2026-09-10T12:00:00.000Z',
    }
    const verdict = await verify(crossing, calls(), [ROUTER_ID], sim, floor)
    expect(verdict.ok, JSON.stringify(!verdict.ok && verdict.reasons)).toBe(true)
  })

  /** The same shortfall on one chain still blocks, so the guard is about crossing. */
  it('still blocks a same-chain trade that received less than promised', async () => {
    const sameChain: Intent = { ...crossing, kind: 'swap', to: `${CHAIN}/slip44:60` }
    const sim: Simulation = {
      provider: 'eth_simulateV1',
      chainId: CHAIN,
      blockNumber: '1',
      success: true,
      assetChanges: [
        delta(`${CHAIN}/erc20:${USDC}`, '-500000000', 'USDC', 6),
        delta(`${CHAIN}/slip44:60`, '1', 'ETH', 18),
      ],
      gasUsed: '210000',
      gasUsd: '0.04',
      resultHash: 'e'.repeat(64),
      ranAt: '2026-09-10T12:00:00.000Z',
    }
    const verdict = await verify(sameChain, calls(), [ROUTER_ID], sim, floor)
    expect((verdict.ok === false && verdict.reasons).toString()).toContain('below the')
  })
})

describe('native value a route declares', () => {
  const ROUTER_ID = `${CHAIN}:${ROUTER}`
  const crossing: Intent = { kind: 'bridge', from: `${CHAIN}/erc20:${USDC}`, to: 'eip155:1/slip44:60', amountIn: '500000000' }
  const approve = (amount: bigint) => encodeFunctionData({ abi: KNOWN_ABI, functionName: 'approve', args: [ROUTER, amount] })
  const withFee = (wei: string) => [call(USDC, approve(500_000_000n)), call(ROUTER, '0xdeadbeef', wei)]
  const floor = { expectedOut: '27639745518623', minOut: '27501546791030' }

  /**
   * Found live: a USDC bridge from Base to Arbitrum carried 0.00004 ETH for
   * the relayer, and the policy blocked it as value nobody asked for. It was
   * right to be suspicious and wrong to be certain — so the route declares
   * the fee and gets held to the declaration.
   */
  it('passes a fee the route declared, and says so on the plan', async () => {
    const verdict = await verify(crossing, withFee('40106615832154'), [ROUTER_ID], undefined, {
      ...floor,
      nativeFee: '40106615832154',
    })
    expect(verdict.ok, JSON.stringify(!verdict.ok && verdict.reasons)).toBe(true)
    expect(verdict.warnings.map((w) => w.code)).toContain('route_native_fee')
  })

  it('blocks value above what was declared', async () => {
    const verdict = await verify(crossing, withFee('40106615832155'), [ROUTER_ID], undefined, {
      ...floor,
      nativeFee: '40106615832154',
    })
    expect((verdict.ok === false && verdict.reasons).toString()).toContain('above the 40106615832154 the route declared')
  })

  it('blocks value nothing declared at all', async () => {
    const verdict = await verify(crossing, withFee('1'), [ROUTER_ID], undefined, floor)
    expect((verdict.ok === false && verdict.reasons).toString()).toContain('which the intent did not ask for')
  })

  /** A declaration is spent once, not charged per call. */
  it('does not let one declared fee cover two calls', async () => {
    const calls = [call(USDC, approve(500_000_000n), '5'), call(ROUTER, '0xdeadbeef', '5')]
    const verdict = await verify(crossing, calls, [ROUTER_ID], undefined, { ...floor, nativeFee: '5' })
    expect((verdict.ok === false && verdict.reasons).toString()).toContain('above the 5 the route declared')
  })

  it('still lets a native-input trade send its own value freely', async () => {
    const native: Intent = { kind: 'swap', from: `${CHAIN}/slip44:60`, to: `${CHAIN}/erc20:${USDC}`, amountIn: '1000' }
    const verdict = await verify(native, [call(ROUTER, '0xdeadbeef', '1000')], [ROUTER_ID], undefined, floor)
    expect(verdict.ok, JSON.stringify(!verdict.ok && verdict.reasons)).toBe(true)
  })
})

/**
 * The custom tier. The agent authored the calls, so the declaration is what
 * they are held to — and a simulation is required, not optional.
 */
describe('an agent-authored plan', () => {
  const PM = '0x03a520b32c04bf3beef7beb72e919cf822ed34f1'
  const GUESSED = '0x4444444444444444444444444444444444444444'
  const WETH = '0x4200000000000000000000000000000000000006'
  const CLAIM_ABI = [
    { type: 'function', name: 'claimFees', inputs: [], outputs: [], stateMutability: 'nonpayable' },
  ] as const
  const claimFees = encodeFunctionData({ abi: CLAIM_ABI, functionName: 'claimFees' })

  /** USDC and the position manager are verified; GUESSED has code, no source, and a 4byte name. */
  const custom: Lookups = {
    ...lookups,
    async getCode(c, address) {
      return [PM, GUESSED].includes(address.toLowerCase()) ? '0x6080' : lookups.getCode(c, address)
    },
    async sourcify(c, address) {
      if (address.toLowerCase() === PM) return { abi: CLAIM_ABI as never, name: 'NonfungiblePositionManager', match: 'exact_match' }
      return lookups.sourcify(c, address)
    },
    async fourByte() {
      return ['claim()']
    },
  }

  const intent = (over: Partial<Extract<Intent, { kind: 'custom' }>> = {}): Intent => ({
    kind: 'custom',
    fromAccount: `${CHAIN}:${ALICE}`,
    chainId: CHAIN,
    summary: 'Approve 1 USDC to the position manager and claim fees',
    expectedChanges: [{ asset: `${CHAIN}/erc20:${USDC}`, maxOut: '1000000' }],
    approvals: [{ asset: `${CHAIN}/erc20:${USDC}`, spender: `${CHAIN}:${PM}`, amount: '1000000' }],
    ...over,
  })
  const approve = (spender: string, amount: bigint) =>
    encodeFunctionData({ abi: KNOWN_ABI, functionName: 'approve', args: [spender, amount] })
  const honest = [call(USDC, approve(PM, 1_000_000n)), call(PM, claimFees)]
  const traced = (changes: AssetDelta[] = [delta(`${CHAIN}/erc20:${USDC}`, '-1000000', 'USDC', 6)]) =>
    ran({ tracedAssets: true, assetChanges: changes })

  async function verifyCustom(i: Intent, calls: Call[], simulation?: Simulation | null) {
    const decodedActions = await decodeCalls(calls, custom)
    return verifyPlan({ intent: i, calls, decodedActions, ...(simulation !== undefined ? { simulation } : {}) })
  }

  it('passes when the bytes, the approval and the run all match the declaration', async () => {
    expect(await verifyCustom(intent(), honest, traced())).toEqual({ ok: true, warnings: [] })
  })

  /** The vendor's own calls, forwarded verbatim. The LP API asks for exactly this. */
  it('refuses the unlimited approval a vendor hands back', async () => {
    const verdict = await verifyCustom(intent(), [call(USDC, approve(PM, maxUint256)), call(PM, claimFees)], traced())
    expect(verdict.ok).toBe(false)
    expect(verdict).toMatchObject({ reasons: expect.arrayContaining([expect.stringMatching(/unlimited approval/)]) })
  })

  it('holds the approval to the declared amount and the declared token', async () => {
    const more = await verifyCustom(intent(), [call(USDC, approve(PM, 2_000_000n)), call(PM, claimFees)], traced())
    expect(more).toMatchObject({ ok: false, reasons: [expect.stringMatching(/approves 2000000 .* declaration says 1000000/)] })
    // Same spender, a token the declaration never named for it.
    const other = await verifyCustom(intent(), [call(WETH, approve(PM, 1_000_000n)), call(PM, claimFees)], traced())
    expect(other.ok).toBe(false)
    expect(other).toMatchObject({ reasons: expect.arrayContaining([expect.stringMatching(/does not name for that token/)]) })
  })

  it('only cautions on an approval the declaration names but no call makes', async () => {
    const verdict = await verifyCustom(intent(), [call(PM, claimFees)], traced([]))
    expect(verdict.ok).toBe(true)
    expect(verdict.warnings.map((w) => w.code)).toEqual(['declared_approval_absent'])
  })

  describe('what the simulation saw leave', () => {
    it('is an upper bound: less than declared passes, more is inked', async () => {
      const less = await verifyCustom(intent({ expectedChanges: [{ asset: `${CHAIN}/erc20:${USDC}`, maxOut: '5000000' }] }), honest, traced())
      expect(less.ok).toBe(true)
      const more = await verifyCustom(intent(), honest, traced([delta(`${CHAIN}/erc20:${USDC}`, '-5000000', 'USDC', 6)]))
      expect(more).toMatchObject({ ok: false, reasons: [expect.stringMatching(/5000000 USDC leaving, above the 1000000/)] })
    })

    it('inks an asset leaving that the declaration never mentioned', async () => {
      const changes = [delta(`${CHAIN}/erc20:${USDC}`, '-1000000', 'USDC', 6), delta(`${CHAIN}/erc20:${WETH}`, '-1', 'WETH', 18)]
      const verdict = await verifyCustom(intent(), honest, traced(changes))
      expect(verdict).toMatchObject({ ok: false, reasons: [expect.stringMatching(/WETH leaving, which the declaration does not mention/)] })
    })

    it('ignores what arrives — that side is not declared and not checked', async () => {
      const changes = [delta(`${CHAIN}/erc20:${USDC}`, '-1000000', 'USDC', 6), delta(`${CHAIN}/erc20:${WETH}`, '+99', 'WETH', 18)]
      expect(await verifyCustom(intent(), honest, traced(changes))).toEqual({ ok: true, warnings: [] })
    })
  })

  describe('the simulation is required', () => {
    it('inks a plan no simulation ran for', async () => {
      const verdict = await verifyCustom(intent(), honest, null)
      expect(verdict).toMatchObject({ ok: false, reasons: [expect.stringMatching(/no simulation ran/)] })
    })

    it('inks a run that never traced balances, even a successful one', async () => {
      const verdict = await verifyCustom(intent(), honest, ran({ tracedAssets: false, assetChanges: [] }))
      expect(verdict).toMatchObject({ ok: false, reasons: [expect.stringMatching(/did not trace balances/)] })
    })

    it('inks a run that reverted, saying which call', async () => {
      const verdict = await verifyCustom(intent(), honest, ran({ success: false, failedCall: 2, revertReason: 'nothing to claim', tracedAssets: true, assetChanges: [] }))
      expect(verdict).toMatchObject({ ok: false, reasons: [expect.stringMatching(/failed on call 2: nothing to claim/)] })
    })
  })

  describe('the bytes must be readable from source', () => {
    it('refuses a name that came from a selector database', async () => {
      const guessed = intent({ expectedChanges: [], approvals: [] })
      const verdict = await verifyCustom(guessed, [call(GUESSED, '0x4e71d92d')], traced([]))
      expect(verdict.ok).toBe(false)
      expect(verdict).toMatchObject({
        reasons: expect.arrayContaining([expect.stringMatching(/no verified source/), expect.stringMatching(/selector database/)]),
      })
    })

    it('refuses calldata sent to an address with no code', async () => {
      const verdict = await verifyCustom(intent({ expectedChanges: [], approvals: [] }), [call(ALICE, claimFees)], traced([]))
      expect(verdict).toMatchObject({ ok: false, reasons: [expect.stringMatching(/which has no code/)] })
    })
  })

  describe('native value', () => {
    it('is a block when the declaration is silent, and passes when declared', async () => {
      const paying = [call(PM, claimFees, '1000')]
      const silent = await verifyCustom(intent({ expectedChanges: [], approvals: [] }), paying, traced([]))
      expect(silent).toMatchObject({ ok: false, reasons: [expect.stringMatching(/1000 wei .* does not mention/)] })
      const declared = await verifyCustom(intent({ expectedChanges: [], approvals: [], nativeValue: '1000' }), paying, traced([]))
      expect(declared.ok).toBe(true)
    })

    it('spends the declaration once, not once per call', async () => {
      const twice = [call(PM, claimFees, '1000'), call(PM, claimFees, '1000')]
      const verdict = await verifyCustom(intent({ expectedChanges: [], approvals: [], nativeValue: '1000' }), twice, traced([]))
      expect(verdict).toMatchObject({ ok: false, reasons: [expect.stringMatching(/above the 1000 the declaration allows/)] })
    })
  })
})
