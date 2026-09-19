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

async function verify(intent: Intent, calls: Call[], allowedSpenders?: string[], simulation?: Simulation | null) {
  const decodedActions = await decodeCalls(calls, lookups)
  return verifyPlan({
    intent,
    calls,
    decodedActions,
    ...(allowedSpenders ? { allowedSpenders } : {}),
    ...(simulation !== undefined ? { simulation } : {}),
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
    const swap: Intent = { kind: 'swap', from: `${CHAIN}/slip44:60`, to: `${CHAIN}/erc20:${USDC}`, amountIn: '1' }
    const verdict = verifyPlan({ intent: swap, calls: [], decodedActions: [] })
    expect(!verdict.ok && verdict.reasons).toEqual(['swap plans cannot be verified yet'])
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
