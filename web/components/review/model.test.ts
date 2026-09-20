import { describe, expect, it } from 'vitest'
import type { Plan } from '@/lib/api'
import { gateFor } from './wallet-gate'
import {
  approvalAmount,
  approvals,
  approxUsd,
  assetChanges,
  canSign,
  countdown,
  decodedRows,
  effectiveStatus,
  changeSource,
  keyFacts,
  planSteps,
  liveRefusal,
  executability,
  headsUp,
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

describe('a price beside the amount', () => {
  it('estimates in dollars and says it is an estimate', () => {
    expect(approxUsd('500', 1)).toBe('≈ $500.00')
    expect(approxUsd('1,250.5', 2)).toBe('≈ $2,501.00')
  })

  it('says nothing without a price, and does not price dust', () => {
    expect(approxUsd('500', null)).toBeNull()
    expect(approxUsd('500', 0)).toBeNull()
    expect(approxUsd('<0.001', 4000)).toBeNull()
    expect(approxUsd('0.000001', 1)).toBe('< $0.01')
  })
})

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
    expect(assetChanges(plan)).toEqual([{ assetId: `${BASE}/erc20:${USDC}`, chainId: BASE, direction: 'out', amount: '500', symbol: 'USDC', where: 'leaves Main' }])
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
      { assetId: `${BASE}/erc20:${USDC}`, chainId: BASE, direction: 'out', amount: '500', symbol: 'USDC', where: 'leaves Main' },
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

  it('keeps a bridge’s far side from the quote beneath what was observed', () => {
    const BNB = 'eip155:56'
    const USDT = '0x55d398326f99059ff775485246999027b3197955'
    const bridge: Plan = {
      ...simulated({
        chainId: BNB,
        assetChanges: [{ assetId: `${BNB}/erc20:${USDT}`, symbol: 'USDT', decimals: 18, diff: '-41750000000000000000', pre: '41750000000000000000', post: '0' }],
      }),
      intent: { kind: 'bridge', from: `${BNB}/erc20:${USDT}`, to: `${BASE}/erc20:${USDC}`, amountIn: '41750000000000000000', slippageBps: 50 },
      quote: { provider: 'lifi', expiresAt: '2026-09-09T16:32:59Z', expectedOut: '41634022', minOut: '41425852' },
      resolution: { ...plan.resolution, account: { caip10: `${BNB}:${plan.resolution.account.caip10.split(':')[2]}`, label: 'Main' } },
      humanPlan: {
        ...plan.humanPlan,
        assets: [
          { id: `${BNB}/erc20:${USDT}`, symbol: 'USDT', decimals: 18 },
          { id: `${BASE}/erc20:${USDC}`, symbol: 'USDC', decimals: 6 },
        ],
      },
    } as Plan
    expect(assetChanges(bridge).map((c) => `${c.direction} ${c.amount} ${c.symbol} ${c.chainId} ${c.where}${c.estimate ? ' (about)' : ''}`)).toEqual([
      'out 41.75 USDT eip155:56 leaves Main',
      'in 41.634022 USDC eip155:8453 arrives on Base in Main (about)',
    ])
    // Before any run, the same two rows, both from the request.
    const unrun = { ...bridge, simulation: null } as Plan
    expect(assetChanges(unrun).map((c) => c.chainId)).toEqual([BNB, BASE])
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
      { assetId: `${BASE}/erc20:${USDC}`, chainId: BASE, direction: 'out', amount: '500', symbol: 'USDC', where: 'leaves Main' },
      { assetId: `${BASE}/erc20:${DEGEN}`, chainId: BASE, direction: 'in', amount: '9.5', symbol: 'DEGEN', where: 'arrives in Main', estimate: true },
    ])
  })

  it('names the destination chain when the trade crosses one', () => {
    const rows = assetChanges(trade('bridge', `eip155:42161/erc20:${DEGEN}`))
    expect(rows[1]).toMatchObject({ direction: 'in', chainId: 'eip155:42161', where: 'arrives on Arbitrum One in Main' })
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

describe('the steps the wallet will be asked for', () => {
  const ROUTER = '0x1231deb6f5749ef6ce6943a275a1d3e7486f4eae'
  const approval = {
    target: `${BASE}:${USDC}`,
    isContract: true,
    source: 'abi' as const,
    verified: true,
    function: 'approve(address,uint256)',
    args: [],
    value: '0',
    approval: { spender: `${BASE}:${ROUTER}`, amount: '500000000' },
  }
  const opaque = {
    target: `${BASE}:${ROUTER}`,
    isContract: true,
    source: 'unknown' as const,
    verified: true,
    function: 'unknown',
    args: [],
    value: '0',
  }
  const swap = (): Plan => ({
    ...plan,
    intent: { kind: 'swap', from: `${BASE}/erc20:${USDC}`, to: `${BASE}/slip44:60`, amountIn: '500000000' },
    outcome: {
      type: 'calls',
      calls: [
        { to: `${BASE}:${USDC}`, value: '0', data: '0x095ea7b3', chainId: BASE },
        { to: `${BASE}:${ROUTER}`, value: '0', data: '0xdeadbeef', chainId: BASE },
      ],
    },
    humanPlan: {
      ...plan.humanPlan,
      steps: [
        'Swap on Bitget',
        'Bridge with Squid to Arbitrum One',
        'At least 0.1194 ETH, or it reverts',
        'Note from the request: rent',
      ],
      assets: [{ id: `${BASE}/erc20:${USDC}`, symbol: 'USDC', decimals: 6 }],
    },
    decodedActions: [approval, opaque],
  })

  /**
   * The panel used to say "One signature in your wallet" and draw one row
   * whatever the plan held, so a swap's approval was invisible until the
   * wallet opened twice.
   */
  it('is one row per call, not one row per plan', () => {
    const steps = planSteps(swap())
    expect(steps).toHaveLength(2)
    expect(steps[0]).toEqual({ index: 1, label: 'Approve 500 USDC', detail: 'for 0x1231…4eae' })
  })

  it('gives the route’s own words to the call that executes the route', () => {
    // One call runs the whole route, however many hops the provider listed.
    expect(planSteps(swap())[1]).toEqual({ index: 2, label: 'Swap on Bitget, then Bridge with Squid to Arbitrum One' })
  })

  /** The floor and the note are this page's sentences, not the route's hops. */
  it('leaves out the sentences the plan added around the route', () => {
    const labels = planSteps(swap()).map((s) => s.label)
    expect(labels.join(' ')).not.toContain('At least')
    expect(labels.join(' ')).not.toContain('Note from the request')
  })

  it('says plainly when a call could not be read', () => {
    const bare = { ...swap(), humanPlan: { ...swap().humanPlan, steps: [] } }
    expect(planSteps(bare)[1]).toMatchObject({ label: 'A call this page could not read', detail: 'on 0x1231…4eae' })
  })

  it('names an unlimited approval as unlimited rather than as a number', () => {
    const greedy = {
      ...swap(),
      decodedActions: [{ ...approval, approval: { spender: `${BASE}:${ROUTER}`, amount: 'unlimited' } }, opaque],
    }
    expect(planSteps(greedy)[0]?.label).toBe('Approve unlimited')
  })

  /** The arguments are right there; printing the signature would waste them. */
  it('is a single row for a transfer, saying what it moves and to whom', () => {
    expect(planSteps(plan)).toEqual([{ index: 1, label: 'Send 500 USDC', detail: 'to 0x67d2…98d2' }])
  })
})

/**
 * An agent-crafted plan. The declaration stands in for the request, and the
 * page must read it as a ceiling the agent promised, not a figure it knows.
 */
describe('an agent-crafted plan', () => {
  const WETH = '0x4200000000000000000000000000000000000006'
  const PM = '0x03a520b32c04bf3beef7beb72e919cf822ed34f1'
  const custom: Plan = {
    ...plan,
    provenance: 'agent_crafted',
    intent: {
      kind: 'custom',
      fromAccount: `${BASE}:${MAIN}`,
      chainId: BASE,
      summary: 'Add 1 USDC and the matching WETH to the USDC/WETH 0.05% pool',
      expectedChanges: [
        { asset: `${BASE}/erc20:${USDC}`, maxOut: '1000000' },
        { asset: `${BASE}/erc20:${WETH}`, maxOut: '1208327299744937' },
      ],
      approvals: [{ asset: `${BASE}/erc20:${USDC}`, spender: `${BASE}:${PM}`, amount: '1000000' }],
      note: 'earn fees on idle USDC',
    },
    humanPlan: {
      ...plan.humanPlan,
      summary: 'Add 1 USDC and the matching WETH to the USDC/WETH 0.05% pool',
      assets: [
        { id: `${BASE}/erc20:${USDC}`, symbol: 'USDC', decimals: 6 },
        { id: `${BASE}/erc20:${WETH}`, symbol: 'WETH', decimals: 18 },
      ],
    },
    simulation: null,
  }

  it('shows each declared ceiling as an outgoing row, and says it is a ceiling', () => {
    const rows = assetChanges(custom)
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ direction: 'out', amount: '1', symbol: 'USDC', where: 'at most, leaves Main' })
    expect(rows[1]).toMatchObject({ direction: 'out', symbol: 'WETH' })
  })

  it('labels the rows as declared, not as the request', () => {
    expect(changeSource(custom)).toBe('declared')
    // Once a simulation has been observed the declaration steps aside, as it does for any plan.
    const observed = { ...custom, simulation: { ...plan.simulation!, assetChanges: [{ assetId: `${BASE}/erc20:${USDC}`, symbol: 'USDC', decimals: 6, diff: '-1000000', pre: '10000000', post: '9000000' }] } }
    expect(changeSource(observed)).toBe('stored')
  })

  it('carries the note into the key facts like a transfer does', () => {
    expect(keyFacts(custom)).toContainEqual({ label: 'Note', value: 'earn fees on idle USDC' })
  })

  /**
   * The approved token is the call's target. Naming it after the asset the
   * plan spends would call a WETH allowance "USDC" on this very plan.
   */
  it('names an approval in the words of the token it is on, not the asset the plan leads with', () => {
    const granting: Plan = {
      ...custom,
      decodedActions: [
        {
          target: `${BASE}:${WETH}`,
          isContract: true,
          source: 'abi',
          verified: true,
          contractName: 'WETH9',
          function: 'approve(address,uint256)',
          args: [],
          value: '0',
          approval: { spender: `${BASE}:${PM}`, amount: '1208327299744937' },
        },
      ],
    }
    const [grant] = approvals(granting)
    expect(grant).toMatchObject({ asset: `${BASE}/erc20:${WETH}`, unlimited: false, spenderName: null })
    expect(approvalAmount(granting, grant!)).toBe('0.001208 WETH')
    expect(standingApproval(granting)).toMatchObject({ amount: '0.001208', symbol: 'WETH' })
  })

  it('counts what there is to read first, and grades it by the worst of it', () => {
    expect(headsUp(custom)).toMatchObject({ count: 0, worst: null })
    const cautious: Plan = {
      ...custom,
      humanPlan: { ...custom.humanPlan, warnings: [{ severity: 'caution', code: 'x', message: 'Careful' }, { severity: 'info', code: 'y', message: 'FYI' }] },
    }
    expect(headsUp(cautious)).toMatchObject({ count: 1, worst: 'caution' })
    const greedy: Plan = {
      ...cautious,
      decodedActions: [{ ...cautious.decodedActions[0]!, approval: { spender: `${BASE}:${PM}`, amount: 'unlimited' } }],
    }
    expect(headsUp(greedy)).toMatchObject({ count: 2, worst: 'block' })
  })
})
