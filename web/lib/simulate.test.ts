import { ethAddress, zeroAddress } from 'viem'
import { describe, expect, it } from 'vitest'
import type { Plan } from './api'
import { decoderUrl } from './simulators'
import { type NativeWords, type RawChange, type SimulationAnswer, read, reasonOf } from './simulate'

const BASE = 'eip155:8453'
const USDC = '0x833589FCD6EDb6E08f4c7C32D4f71b54bdA02913'
const ETH_NATIVE: NativeWords = { nativeAssetId: `${BASE}/slip44:60`, nativeSymbol: 'ETH', nativeDecimals: 18 }
const BNB_NATIVE: NativeWords = { nativeAssetId: 'eip155:56/slip44:714', nativeSymbol: 'BNB', nativeDecimals: 18 }
const NOW = new Date('2026-09-10T12:00:00Z')

const change = (address: string, pre: bigint, post: bigint, token: Partial<RawChange['token']> = {}): RawChange => ({
  token: { address, ...token },
  value: { pre, post, diff: post - pre },
})

const answer = (over: Partial<SimulationAnswer> = {}): SimulationAnswer => ({
  block: { number: 51119499n },
  results: [{ status: 'success', gasUsed: 44831n }],
  assetChanges: [],
  ...over,
})

describe('reading a browser simulation', () => {
  it('reports success, the block and the gas the batch burned', () => {
    const run = read(answer({ results: [{ status: 'success', gasUsed: 21000n }, { status: 'success', gasUsed: 44831n }] }), {
      chainId: BASE,
      via: 'public',
      native: ETH_NATIVE,
      now: NOW,
    })
    expect(run).toMatchObject({
      success: true,
      blockNumber: '51119499',
      gasUsed: '65831',
      via: 'public',
      provider: 'eth_simulateV1 · public RPC',
      ranAt: '2026-09-10T12:00:00.000Z',
    })
  })

  it('says which call reverted and why', () => {
    const run = read(
      answer({
        results: [
          { status: 'success', gasUsed: 21000n },
          {
            status: 'failure',
            gasUsed: 35996n,
            error: { shortMessage: 'The contract function "<unknown>" reverted with the following reason:\nERC20: transfer amount exceeds balance' },
          },
        ],
      }),
      { chainId: BASE, via: 'public', native: ETH_NATIVE, now: NOW },
    )
    expect(run.success).toBe(false)
    expect(run.failedCall).toBe(2)
    expect(run.revertReason).toBe('ERC20: transfer amount exceeds balance')
  })

  it('names the wallet’s own node when that is what answered', () => {
    const run = read(answer(), { chainId: BASE, via: 'wallet', native: ETH_NATIVE, now: NOW })
    expect(run.provider).toContain('your wallet')
  })

  /** The dollar figure was priced and hashed with the plan. The browser has no feed. */
  it('never invents a fee', () => {
    expect(read(answer(), { chainId: BASE, via: 'public', native: ETH_NATIVE, now: NOW }).gasUsd).toBe('unknown')
  })
})

describe('naming what moved', () => {
  const rowsFor = (changes: RawChange[], chainId = BASE, native: NativeWords = ETH_NATIVE) =>
    read(answer({ assetChanges: changes }), { chainId, via: 'public', native, now: NOW }).assetChanges

  it('takes the native currency’s name from the service, not from viem', () => {
    // viem labels every native balance ETH/18. On BNB Chain that is the wrong
    // currency, and the page would tell someone they are sending ETH.
    const [row] = rowsFor([change(ethAddress, 1000n, 0n, { symbol: 'ETH', decimals: 18 })], 'eip155:56', BNB_NATIVE)
    expect(row).toMatchObject({ assetId: 'eip155:56/slip44:714', symbol: 'BNB', diff: '-1000' })
  })

  it('reads the zero address as native too', () => {
    expect(rowsFor([change(zeroAddress, 5n, 4n)])[0]?.assetId).toBe(`${BASE}/slip44:60`)
  })

  it('lowercases a token into its CAIP-19 id and keeps the words it was given', () => {
    const [row] = rowsFor([change(USDC, 1_000_000n, 500_000n, { symbol: 'USDC', decimals: 6 })])
    expect(row).toEqual({
      assetId: `${BASE}/erc20:${USDC.toLowerCase()}`,
      symbol: 'USDC',
      decimals: 6,
      diff: '-500000',
      pre: '1000000',
      post: '500000',
    })
  })

  it('keeps an unlabelled token as a row with no words', () => {
    expect(rowsFor([change('0x1111111111111111111111111111111111111111', 2n, 1n)])[0]).toMatchObject({
      symbol: null,
      decimals: null,
    })
  })

  it('drops a balance that did not move', () => {
    expect(rowsFor([change(USDC, 7n, 7n, { symbol: 'USDC', decimals: 6 })])).toEqual([])
  })

  it('drops the native row on a chain whose currency the service could not name', () => {
    const nameless: NativeWords = { nativeAssetId: null, nativeSymbol: 'units', nativeDecimals: 18 }
    expect(rowsFor([change(ethAddress, 5n, 4n)], BASE, nameless)).toEqual([])
  })

  it('puts the biggest movement first, outgoing before incoming, ties on the id', () => {
    const rows = rowsFor([
      change(USDC, 0n, 5n, { symbol: 'USDC', decimals: 6 }),
      change('0x2222222222222222222222222222222222222222', 100n, 0n, { symbol: 'WETH', decimals: 18 }),
      change('0x3333333333333333333333333333333333333333', 0n, 5n, { symbol: 'DAI', decimals: 18 }),
      change(ethAddress, 5n, 0n),
    ])
    expect(rows.map((r) => `${r.symbol}:${r.diff}`)).toEqual(['WETH:-100', 'ETH:-5', 'DAI:5', 'USDC:5'])
  })
})

describe('reading an error', () => {
  it('takes the contract’s own revert string, not viem’s lead-in', () => {
    expect(
      reasonOf({ shortMessage: 'The contract function "<unknown>" reverted with the following reason:\nERC20: paused' }),
    ).toBe('ERC20: paused')
  })

  it('says so plainly when there was no reason', () => {
    expect(reasonOf({ shortMessage: 'The contract function "<unknown>" reverted with the following reason:' })).toBe(
      'the call reverted without giving a reason',
    )
  })

  /** These are keyless endpoints, but a page that prints URLs is one config change from printing a key. */
  it('drops anything that still looks like a request', () => {
    expect(reasonOf({ shortMessage: 'HTTP request failed: https://mainnet.base.org' })).toBe('the call reverted')
  })

  it('caps a long reason', () => {
    expect(reasonOf({ shortMessage: 'x'.repeat(400) })).toHaveLength(200)
  })
})

describe('the independent decoder link', () => {
  const plan = (calls: { to: string; value: string; data: string; chainId: string }[]) =>
    ({ outcome: { type: 'calls', calls } }) as unknown as Plan

  it('points at the first call that has calldata worth a second opinion', () => {
    const url = decoderUrl(
      plan([
        { to: `${BASE}:0xdead`, value: '1', data: '0x', chainId: BASE },
        { to: `${BASE}:${USDC}`, value: '0', data: '0xa9059cbb0000', chainId: BASE },
      ]),
    )
    expect(url).toBe('https://calldata.swiss-knife.xyz/decoder?calldata=0xa9059cbb0000')
  })

  it('offers no link for a plain value transfer, which has nothing to decode', () => {
    expect(decoderUrl(plan([{ to: `${BASE}:0xdead`, value: '1', data: '0x', chainId: BASE }]))).toBeNull()
  })
})
