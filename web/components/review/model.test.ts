import { describe, expect, it } from 'vitest'
import type { Plan } from '@/lib/api'
import { gateFor } from './wallet-gate'
import {
  assetChanges,
  canSign,
  countdown,
  decodedRows,
  effectiveStatus,
  changeSource,
  keyFacts,
  liveRefusal,
  executability,
  recipientOf,
  simulationNote,
  standingApproval,
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

  /**
   * Two rows, not four. The signer and the network moved onto one line beside
   * the amount and the expiry into the header, because a person deciding
   * whether to send 500 USDC is not reading a table.
   */
  it('keeps only the fee and the note as rows', () => {
    expect(keyFacts(plan).map((f) => [f.label, f.value])).toEqual([
      ['Network fee', 'Shown by your wallet'],
      ['Note', 'rent'],
    ])
  })

  it('drops the note row when the request carried none', () => {
    const bare = { ...plan, intent: { ...plan.intent, note: undefined } } as Plan
    expect(keyFacts(bare).map((f) => f.label)).toEqual(['Network fee'])
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
    expect(changeSource(page)).toBe('stored')
    expect(assetChanges(page)).toEqual([
      { assetId: `${BASE}/erc20:${USDC}`, direction: 'out', amount: '500', symbol: 'USDC', where: 'leaves Main' },
    ])
  })

  it('falls back to the request when nothing was traced, and admits it', () => {
    expect(changeSource(simulated({ assetChanges: [] }))).toBe('request')
    expect(changeSource(plan)).toBe('request')
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

  it('shows the fee once something has priced it', () => {
    const priced = { ...plan, humanPlan: { ...plan.humanPlan, feesUsd: '0.17' } }
    expect(keyFacts(priced)[0]).toMatchObject({ label: 'Network fee', value: '$0.17', detail: 'estimated' })
    expect(keyFacts(plan)[0]).toMatchObject({ label: 'Network fee', value: 'Shown by your wallet' })
  })
})

describe('a run the browser did while the page was open', () => {
  const stored = {
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
  }
  const withStored: Plan = { ...plan, simulation: stored }
  const live = { ...stored, provider: 'eth_simulateV1 · public RPC', blockNumber: '51200000' }

  /**
   * The stored run describes the block the plan was built against; the live
   * one describes the chain the person is about to sign into. When they
   * disagree, the newer one is the one that matters.
   */
  it('outranks the stored run, and the page says which it is showing', () => {
    expect(changeSource(withStored, live)).toBe('live')
    expect(changeSource(withStored, null)).toBe('stored')
    expect(changeSource(plan, null)).toBe('request')
    expect(simulationNote(withStored, live)).toContain('at block 51200000')
    expect(simulationNote(withStored, null)).toContain('at block 51119499')
  })

  it('names its source, so the page never implies a fresher run than it has', () => {
    expect(changeSource(withStored, live)).toBe('live')
    expect(changeSource(withStored, null)).toBe('stored')
    expect(changeSource(plan, null)).toBe('request')
  })

  it('falls back to the stored run when the browser could not simulate', () => {
    expect(assetChanges(withStored, null)).toHaveLength(1)
    expect(changeSource(withStored, null)).toBe('stored')
  })

  it('turns a fresh revert into the sentence that takes signing away', () => {
    const refused = { ...live, success: false, failedCall: 1, revertReason: 'ERC20: transfer amount exceeds balance' }
    expect(liveRefusal(refused)).toBe(
      'Call 1 reverts against the chain as it is right now: ERC20: transfer amount exceeds balance.',
    )
    expect(liveRefusal(live)).toBeNull()
    expect(liveRefusal(null)).toBeNull()
  })
})

describe('the mark on the card', () => {
  const sim = (success: boolean) => ({
    provider: 'eth_simulateV1 · public RPC',
    chainId: BASE,
    blockNumber: '51200000',
    success,
    assetChanges: [],
    gasUsed: '21000',
    gasUsd: 'unknown',
    resultHash: '',
    ranAt: '2026-09-10T12:00:00.000Z',
    ...(success ? {} : { failedCall: 1, revertReason: 'ERC20: transfer amount exceeds balance' }),
  })

  /** Two words, not a paragraph. The reason lives in Advanced review. */
  it('reads executable when a run succeeded and may fail when it did not', () => {
    expect(executability(plan, sim(true))).toEqual({ ok: true, label: 'Executable' })
    expect(executability(plan, sim(false))).toEqual({ ok: false, label: 'May fail' })
  })

  it('says nothing at all when nothing has run', () => {
    expect(executability(plan, null)).toBeNull()
    expect(executability(plan)).toBeNull()
  })

  it('falls back to the stored run when the browser has none', () => {
    expect(executability({ ...plan, simulation: sim(false) }, null)).toEqual({ ok: false, label: 'May fail' })
  })
})

describe('what a half-signed swap would leave behind', () => {
  const ROUTER = '0x1231deb6f5749ef6ce6943a275a1d3e7486f4eae'
  const swap = (approval: { spender: string; amount: string }): Plan => ({
    ...plan,
    intent: { kind: 'swap', from: `${BASE}/erc20:${USDC}`, to: `${BASE}/slip44:60`, amountIn: '500000000' },
    humanPlan: { ...plan.humanPlan, assets: [{ id: `${BASE}/erc20:${USDC}`, symbol: 'USDC', decimals: 6 }] },
    decodedActions: [
      {
        target: `${BASE}:${USDC}`,
        isContract: true,
        source: 'abi',
        verified: true,
        function: 'approve(address,uint256)',
        args: [],
        value: '0',
        approval,
      },
    ],
  })

  /**
   * The number is the whole point. "An allowance could remain" is not
   * something anybody can weigh; "500 USDC to 0x1231…4eae" is.
   */
  it('names the amount in the asset’s own words and the spender', () => {
    expect(standingApproval(swap({ spender: `${BASE}:${ROUTER}`, amount: '500000000' }))).toEqual({
      spender: `${BASE}:${ROUTER}`,
      amount: '500',
      symbol: 'USDC',
      unlimited: false,
    })
  })

  it('says unlimited plainly, since that is a different question', () => {
    expect(standingApproval(swap({ spender: `${BASE}:${ROUTER}`, amount: 'unlimited' }))).toMatchObject({
      amount: 'unlimited',
      unlimited: true,
    })
  })

  it('has nothing to say about a plan that approves nothing', () => {
    expect(standingApproval(plan)).toBeNull()
  })
})

describe('a trade with nothing simulated yet', () => {
  const DEGEN = '0x4ed4e862860bed51a9570b96d89af5e1b0efefed'
  const trade = (kind: 'swap' | 'bridge', to: string): Plan => ({
    ...plan,
    intent: { kind, from: `${BASE}/erc20:${USDC}`, to, amountIn: '500000000' },
    quote: { provider: 'lifi', expiresAt: plan.quote.expiresAt, expectedOut: '9500000000000000000', minOut: '9400000000000000000' },
    humanPlan: {
      ...plan.humanPlan,
      assets: [
        { id: `${BASE}/erc20:${USDC}`, symbol: 'USDC', decimals: 6 },
        { id: to, symbol: 'DEGEN', decimals: 18 },
      ],
    },
  })

  /**
   * Without this a swap showed no asset rows at all until a simulation
   * landed, so the amounts and the icons hanging off them were absent from
   * the page whose whole job is to say what moves.
   */
  it('reads both sides off the request and the quote', () => {
    const rows = assetChanges(trade('swap', `${BASE}/erc20:${DEGEN}`))
    expect(rows).toEqual([
      { assetId: `${BASE}/erc20:${USDC}`, direction: 'out', amount: '500', symbol: 'USDC', where: 'leaves Main' },
      { assetId: `${BASE}/erc20:${DEGEN}`, direction: 'in', amount: '9.5', symbol: 'DEGEN', where: 'arrives in Main' },
    ])
  })

  it('names the destination chain when the trade crosses one', () => {
    const rows = assetChanges(trade('bridge', `eip155:42161/erc20:${DEGEN}`))
    expect(rows[1]).toMatchObject({ direction: 'in', where: 'arrives on Arbitrum One' })
  })

  it('is labelled as the request, because that is what it is', () => {
    expect(changeSource(trade('swap', `${BASE}/erc20:${DEGEN}`))).toBe('request')
  })

  /** A traced run still wins: it is an observation, this is an expectation. */
  it('gives way to a simulation the moment one lands', () => {
    const page = trade('swap', `${BASE}/erc20:${DEGEN}`)
    const live = {
      provider: 'eth_simulateV1 · public RPC',
      chainId: BASE,
      blockNumber: '51200000',
      success: true,
      assetChanges: [
        { assetId: `${BASE}/erc20:${USDC}`, symbol: 'USDC', decimals: 6, diff: '-500000000', pre: '500000000', post: '0' },
      ],
      gasUsed: '120000',
      gasUsd: 'unknown',
      resultHash: '',
      ranAt: '2026-09-11T12:00:00.000Z',
    }
    expect(assetChanges(page, live)).toHaveLength(1)
    expect(changeSource(page, live)).toBe('live')
  })

  it('shows nothing rather than a half row when the plan never named the assets', () => {
    const bare = { ...trade('swap', `${BASE}/erc20:${DEGEN}`), humanPlan: { ...plan.humanPlan, assets: undefined } }
    expect(assetChanges(bare)).toEqual([])
  })
})
