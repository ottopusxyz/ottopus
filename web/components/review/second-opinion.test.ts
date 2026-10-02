import { describe, expect, it } from 'vitest'
import type { BinanceSimulation, Plan, Simulation } from '@/lib/api'
import { secondOpinion } from './second-opinion'

const BSC = 'eip155:56'
const USDT = '0x55d398326f99059ff775485246999027b3197955'
const NVDA = '0xa9ee28c80f960b889dfbd1902055218cba016f75'
const ROUTER = '0x13f4ea83d0bd40e75c8222255bc855a974568dd4'
const MAIN = '0xd8da6bf26964af9d7eed9e03e53415d37aa96045'
const BNB = `${BSC}/slip44:714`

const plan = {
  resolution: { account: { caip10: `${BSC}:${MAIN}`, label: 'Main' }, candidatesConsidered: [], reason: 'because' },
  humanPlan: {
    summary: 'Buy NVDA with 50 USDT',
    steps: [],
    feesUsd: 'unknown',
    warnings: [],
    assets: [
      { id: `${BSC}/erc20:${USDT}`, symbol: 'USDT', decimals: 18 },
      { id: `${BSC}/erc20:${NVDA}`, symbol: 'NVDAon', decimals: 18 },
    ],
  },
} as unknown as Plan

const own = (over: Partial<Simulation> = {}): Simulation => ({
  provider: 'eth_simulateV1',
  chainId: BSC,
  blockNumber: '61000000',
  success: true,
  assetChanges: [
    { assetId: `${BSC}/erc20:${USDT}`, symbol: 'USDT', decimals: 18, diff: '-50000000000000000000', pre: '0', post: '0' },
    { assetId: `${BSC}/erc20:${NVDA}`, symbol: 'NVDAon', decimals: 18, diff: '280000000000000000', pre: '0', post: '0' },
    { assetId: BNB, symbol: 'BNB', decimals: 18, diff: '-120000000000000', pre: '0', post: '0' },
  ],
  gasUsed: '180000',
  gasUsd: 'unknown',
  resultHash: 'a'.repeat(64),
  ranAt: '2026-10-02T14:03:20.000Z',
  ...over,
})

const binance = (over: Partial<BinanceSimulation> = {}): BinanceSimulation => ({
  provider: 'binance',
  status: 'SUCCESS',
  failReason: null,
  failedCall: null,
  balanceChanges: [
    { assetId: `${BSC}/erc20:${USDT}`, symbol: 'USDT', decimals: 18, diff: '-50000000000000000000' },
    { assetId: `${BSC}/erc20:${NVDA}`, symbol: 'NVDAon', decimals: 18, diff: '280500000000000000' },
  ],
  allowanceChanges: [],
  ranAt: '2026-10-02T14:03:22.000Z',
  ...over,
})

describe('a second simulation beside the page’s own', () => {
  it('agrees when the same assets move the same way, give or take a block of drift', () => {
    const field = secondOpinion(plan, own(), binance())
    expect(field).toMatchObject({ kind: 'ok', verdict: 'agree', note: 'Agrees with the page’s own run.' })
    if (field.kind !== 'ok') throw new Error('unreachable')
    expect(field.rows).toEqual([
      { assetId: `${BSC}/erc20:${USDT}`, chainId: BSC, direction: 'out', amount: '50', symbol: 'USDT', where: 'leaves Main' },
      { assetId: `${BSC}/erc20:${NVDA}`, chainId: BSC, direction: 'in', amount: '0.2805', symbol: 'NVDAon', where: 'arrives in Main' },
    ])
  })

  it('says when it ran, and does not invent a block the vendor never named', () => {
    const field = secondOpinion(plan, own(), binance())
    expect(field.kind === 'ok' && field.provenance).toBe(
      'Simulated by Binance Web3 API against the latest block, at 14:03:22 UTC.',
    )
  })

  it('does not count the gas the page’s run paid and Binance never counts', () => {
    // The native row is on one side only, and that alone is not a difference.
    expect(secondOpinion(plan, own(), binance())).toMatchObject({ verdict: 'agree' })
  })

  it('names the asset when the two figures are further apart than drift', () => {
    const field = secondOpinion(
      plan,
      own(),
      binance({
        balanceChanges: [
          { assetId: `${BSC}/erc20:${USDT}`, symbol: 'USDT', decimals: 18, diff: '-50000000000000000000' },
          { assetId: `${BSC}/erc20:${NVDA}`, symbol: 'NVDAon', decimals: 18, diff: '250000000000000000' },
        ],
      }),
    )
    expect(field).toMatchObject({ verdict: 'differ', note: 'Differs from the page’s own run on NVDAon.' })
  })

  it('differs when one of them saw an asset move that the other did not', () => {
    const field = secondOpinion(
      plan,
      own(),
      binance({ balanceChanges: [{ assetId: `${BSC}/erc20:${USDT}`, symbol: 'USDT', decimals: 18, diff: '-50000000000000000000' }] }),
    )
    expect(field).toMatchObject({ verdict: 'differ', note: 'Differs from the page’s own run on NVDAon.' })
  })

  it('differs when the same asset moves the other way', () => {
    const field = secondOpinion(
      plan,
      own(),
      binance({ balanceChanges: [{ assetId: `${BSC}/erc20:${USDT}`, symbol: 'USDT', decimals: 18, diff: '50000000000000000000' }] }),
    )
    expect(field).toMatchObject({ verdict: 'differ', note: 'Differs from the page’s own run on USDT and NVDAon.' })
  })

  it('differs when Binance passes a plan the page’s own run reverts', () => {
    const field = secondOpinion(plan, own({ success: false, assetChanges: [], revertReason: 'insufficient balance' }), binance())
    expect(field).toMatchObject({ verdict: 'differ' })
    expect(field.kind === 'ok' && field.note).toMatch(/checks neither the balance nor the gas/)
  })

  it('stands alone when the page has no traced run to hold it against', () => {
    expect(secondOpinion(plan, null, binance())).toMatchObject({ kind: 'ok', verdict: 'alone', note: null })
    expect(secondOpinion(plan, own({ assetChanges: [] }), binance())).toMatchObject({ verdict: 'alone' })
  })

  it('does not call it agreement when only the native currency moved', () => {
    const sent = own({ assetChanges: [{ assetId: BNB, symbol: 'BNB', decimals: 18, diff: '-1000120000000000000', pre: '0', post: '0' }] })
    for (const theirs of [[], [{ assetId: BNB, symbol: 'BNB', decimals: 18, diff: '-1000000000000000000' }]]) {
      const field = secondOpinion(plan, sent, binance({ balanceChanges: theirs }))
      expect(field).toMatchObject({ kind: 'ok', verdict: 'alone' })
      expect(field.kind === 'ok' && field.note).toMatch(/^Not compared/)
    }
  })

  it('lists allowance changes with the spender and the amounts before and after', () => {
    const field = secondOpinion(
      plan,
      own(),
      binance({
        allowanceChanges: [
          { tokenAddress: USDT, spender: ROUTER, preAmount: '0', postAmount: '50000000000000000000' },
          { tokenAddress: NVDA, spender: ROUTER, preAmount: '0', postAmount: (2n ** 256n - 1n).toString() },
          { tokenAddress: '0x' + '9'.repeat(40), spender: ROUTER, preAmount: '5', postAmount: '7' },
        ],
      }),
    )
    expect(field.kind === 'ok' && field.allowances).toEqual([
      { token: 'USDT', spender: '0x13f4…8dd4', before: '0', after: '50' },
      { token: 'NVDAon', spender: '0x13f4…8dd4', before: '0', after: 'unlimited' },
      { token: '0x9999…9999', spender: '0x13f4…8dd4', before: '5', after: '7' },
    ])
  })

  it('reports a failure in the vendor’s words, and explains one that is only its method', () => {
    const alone = secondOpinion(
      plan,
      own(),
      binance({ status: 'FAILED', failReason: 'call 2 of 2: transfer amount exceeds allowance', failedCall: 2, balanceChanges: [] }),
    )
    expect(alone).toMatchObject({ kind: 'failed', reason: 'call 2 of 2: transfer amount exceeds allowance' })
    expect(alone.kind === 'failed' && alone.note).toMatch(/runs each call on its own/)

    const real = secondOpinion(plan, own(), binance({ status: 'FAILED', failReason: 'execution reverted', failedCall: 1, balanceChanges: [] }))
    expect(real).toMatchObject({ kind: 'failed', note: 'The page’s own run passed. The two disagree.' })

    const both = secondOpinion(plan, own({ success: false }), binance({ status: 'FAILED', failReason: 'execution reverted', failedCall: 1 }))
    expect(both).toMatchObject({ kind: 'failed', note: null })
  })

  it('is one quiet line when Binance did not answer', () => {
    expect(
      secondOpinion(plan, own(), binance({ status: 'unavailable', failReason: 'no Binance credential is configured', balanceChanges: [] })),
    ).toEqual({ kind: 'unavailable', line: 'No Binance simulation: no Binance credential is configured.' })
  })
})
