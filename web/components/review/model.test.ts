import { describe, expect, it } from 'vitest'
import type { Plan } from '@/lib/api'
import { gateFor } from './wallet-gate'
import {
  assetChanges,
  canSign,
  countdown,
  decodedRows,
  effectiveStatus,
  facts,
  observedChanges,
  recipientOf,
  simulationNote,
  verificationSummary,
} from './model'

const BASE = 'eip155:8453'
const USDC = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913'
const MAIN = '0xd8da6bf26964af9d7eed9e03e53415d37aa96045'
const KOSHIK = '0x67d29520c6f9579fe4b32dcba346620846ef98d2'

const plan: Plan = {
  id: '9611cca5-58de-4328-84bf-8673877fe0eb',
  version: 1,
  userId: 'u',
  createdVia: 'agent',
  intent: { kind: 'transfer', asset: `${BASE}/erc20:${USDC}`, amount: '500000000', to: `${BASE}:${KOSHIK}`, toName: 'koshik.eth', note: 'rent' },
  provenance: 'route_provider',
  resolution: { account: { caip10: `${BASE}:${MAIN}`, label: 'Main' }, candidatesConsidered: [], reason: 'because' },
  outcome: { type: 'calls', calls: [{ to: `${BASE}:${USDC}`, value: '0', data: '0xa9059cbb', chainId: BASE }] },
  quote: { provider: 'ottopus', expiresAt: '2026-09-09T16:32:59Z' },
  humanPlan: {
    summary: 'Send 500 USDC to koshik.eth (0x67d2…98d2) from Main on Base',
    steps: [],
    feesUsd: 'unknown',
    warnings: [],
    assets: [{ id: `${BASE}/erc20:${USDC}`, symbol: 'USDC', decimals: 6 }],
  },
  status: 'awaiting_review',
  expiresAt: '2026-09-09T16:32:59Z',
  planHash: 'e2'.repeat(32),
  decodedActions: [
    {
      target: `${BASE}:${USDC}`,
      isContract: true,
      source: 'abi',
      verified: true,
      contractName: 'FiatTokenProxy',
      function: 'transfer(address,uint256)',
      args: [
        { name: 'to', type: 'address', value: KOSHIK },
        { name: 'amount', type: 'uint256', value: '500000000' },
      ],
      value: '0',
    },
  ],
  simulation: null,
}

const before = new Date('2026-09-09T16:00:00Z').getTime()
const after = new Date('2026-09-09T17:00:00Z').getTime()

describe('status on the page', () => {
  it('reads a pending plan as expired once the clock passes, with no round trip', () => {
    expect(effectiveStatus(plan, before)).toBe('awaiting_review')
    expect(effectiveStatus(plan, after)).toBe('expired')
    expect(canSign(effectiveStatus(plan, after))).toBe(false)
  })

  it('never expires a submitted or terminal plan', () => {
    expect(effectiveStatus({ ...plan, status: 'submitted' }, after)).toBe('submitted')
    expect(effectiveStatus({ ...plan, status: 'confirmed' }, after)).toBe('confirmed')
  })

  it('counts down in minutes and seconds, then goes quiet', () => {
    expect(countdown(plan.expiresAt, before)).toBe('32:59')
    expect(countdown(plan.expiresAt, new Date('2026-09-09T16:32:20Z').getTime())).toBe('39s')
    expect(countdown(plan.expiresAt, after)).toBe('')
  })
})

describe('what the page says', () => {
  it('shows the outgoing amount in the asset’s own words', () => {
    expect(assetChanges(plan)).toEqual([{ assetId: `${BASE}/erc20:${USDC}`, direction: 'out', amount: '500', symbol: 'USDC', where: 'leaves Main' }])
  })

  it('shows nothing rather than guessing when the plan recorded no asset words', () => {
    expect(assetChanges({ ...plan, humanPlan: { ...plan.humanPlan, assets: undefined } })).toEqual([])
  })

  it('names the recipient and keeps the full address beside it', () => {
    expect(recipientOf(plan)).toEqual({ address: KOSHIK, name: 'koshik.eth' })
  })

  it('lists the signer, the network, the fee it cannot estimate yet, and the note', () => {
    expect(facts(plan).map((f) => [f.label, f.value])).toEqual([
      ['Signing with', 'Main'],
      ['Network', 'Base'],
      ['Network fee', 'Your wallet will show it'],
      ['Note', 'rent'],
    ])
  })

  it('pairs each call with its decoding and keeps the raw bytes', () => {
    const [row] = decodedRows(plan)
    expect(row).toMatchObject({ signature: 'transfer(0x67d2…98d2, 500000000)', verified: true, contractName: 'FiatTokenProxy' })
    expect(row!.raw).toEqual({ to: USDC, value: '0', data: '0xa9059cbb' })
    expect(verificationSummary(plan)).toEqual({ allVerified: true, contracts: 1 })
  })
})

describe('the wallet gate', () => {
  const bound = { account: `${BASE}:${MAIN}`, chain: BASE }

  it('asks for the named wallet when nothing is connected', () => {
    expect(gateFor(bound, [])).toEqual({ kind: 'connect', wanted: MAIN })
  })

  it('refuses another account, and says which is wanted', () => {
    expect(gateFor(bound, [{ address: KOSHIK, chainId: BASE }])).toEqual({ kind: 'wrong_account', wanted: MAIN, connected: KOSHIK })
  })

  it('refuses the right account on the wrong chain', () => {
    expect(gateFor(bound, [{ address: MAIN.toUpperCase().replace('0X', '0x'), chainId: 'eip155:1' }])).toEqual({
      kind: 'wrong_chain',
      wanted: MAIN,
      chain: BASE,
      on: 'eip155:1',
    })
  })

  it('opens only for the named account on the named chain, whatever the casing', () => {
    expect(gateFor(bound, [{ address: KOSHIK, chainId: BASE }, { address: MAIN.toUpperCase().replace('0X', '0x'), chainId: 'EIP155:8453' }])).toEqual({
      kind: 'ready',
      address: MAIN,
      chain: BASE,
    })
  })
})

describe('what the simulation observed', () => {
  const simulated = (over: Partial<NonNullable<Plan['simulation']>> = {}): Plan => ({
    ...plan,
    simulation: {
      provider: 'eth_simulateV1',
      chainId: BASE,
      blockNumber: '51119499',
      success: true,
      assetChanges: [
        { assetId: `${BASE}/erc20:${USDC}`, symbol: 'USDC', decimals: 6, diff: '-500000000', pre: '1000000000', post: '500000000' },
      ],
      gasUsed: '44831',
      gasUsd: '0.17',
      resultHash: 'a'.repeat(64),
      ranAt: '2026-09-10T12:00:00.000Z',
      ...over,
    },
  })

  it('prefers the traced balances over the request, and says which it is showing', () => {
    const page = simulated()
    expect(observedChanges(page)).toBe(true)
    expect(assetChanges(page)).toEqual([
      { assetId: `${BASE}/erc20:${USDC}`, direction: 'out', amount: '500', symbol: 'USDC', where: 'leaves Main' },
    ])
  })

  it('falls back to the request when nothing was traced, and admits it', () => {
    expect(observedChanges(simulated({ assetChanges: [] }))).toBe(false)
    expect(observedChanges(plan)).toBe(false)
    expect(assetChanges(simulated({ assetChanges: [] }))).toHaveLength(1)
  })

  it('reads the sign of the change as the direction', () => {
    const page = simulated({
      assetChanges: [
        { assetId: `${BASE}/erc20:${USDC}`, symbol: 'USDC', decimals: 6, diff: '-500000000', pre: '1000000000', post: '500000000' },
        { assetId: `${BASE}/slip44:60`, symbol: 'ETH', decimals: 18, diff: '2000000000000000', pre: '0', post: '2000000000000000' },
      ],
    })
    expect(assetChanges(page).map((c) => `${c.direction} ${c.amount} ${c.symbol} ${c.where}`)).toEqual([
      'out 500 USDC leaves Main',
      'in 0.002 ETH arrives in Main',
    ])
  })

  it('shows a token it could not name in that token’s own units', () => {
    const page = simulated({
      assetChanges: [
        { assetId: `${BASE}/erc20:0x1111111111111111111111111111111111111111`, symbol: null, decimals: null, diff: '-4200', pre: '4200', post: '0' },
      ],
    })
    expect(assetChanges(page)[0]).toMatchObject({ amount: '4200', symbol: 'units' })
  })

  it('names the simulator and calls the result a prediction', () => {
    expect(simulationNote(simulated())).toBe('Simulated by eth_simulateV1 at block 51119499. A prediction, not a guarantee.')
  })

  it('says what reverted when the simulation failed', () => {
    const note = simulationNote(simulated({ success: false, failedCall: 1, revertReason: 'ERC20: transfer amount exceeds balance' }))
    expect(note).toBe('eth_simulateV1 at block 51119499 — call 1 reverted: ERC20: transfer amount exceeds balance')
  })

  it('has nothing to say when no simulation ran', () => {
    expect(simulationNote(plan)).toBeNull()
  })

  it('shows the fee once the simulation has priced it', () => {
    const page = { ...simulated(), humanPlan: { ...plan.humanPlan, feesUsd: '0.17' } }
    expect(facts(page).map((f) => `${f.label}: ${f.value}`)).toContain('Network fee (est.): $0.17')
    expect(facts(plan).map((f) => `${f.label}: ${f.value}`)).toContain('Network fee: Your wallet will show it')
  })
})
