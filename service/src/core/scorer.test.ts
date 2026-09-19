import { describe, expect, it } from 'vitest'
import type { TransferIntent } from './intent.js'
import {
  type RouteFacts,
  type WalletCandidate,
  candidateName,
  disqualify,
  resolveTransferWallet,
  transferIneligibility,
} from './scorer.js'

const CHAIN = 'eip155:8453'
const USDC = { symbol: 'USDC', decimals: 6 }
const ETH = { symbol: 'ETH', decimals: 18 }

const wallet = (n: number, over: Partial<WalletCandidate> = {}): WalletCandidate => ({
  walletId: `w${n}`,
  account: `${CHAIN}:0x${n.toString(16).padStart(40, '0')}`,
  label: null,
  canSign: true,
  assetBalance: 1_000_000_000n, // 1000 USDC
  gasBalance: 10n ** 16n,
  ...over,
})

const usdcIntent: TransferIntent = {
  kind: 'transfer',
  asset: `${CHAIN}/erc20:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913`,
  amount: '500000000',
  to: `${CHAIN}:0xd8da6bf26964af9d7eed9e03e53415d37aa96045`,
}

const ethIntent: TransferIntent = { ...usdcIntent, asset: `${CHAIN}/slip44:60`, amount: '1000000000000000000' }

describe('disqualifiers beat price', () => {
  const clean: RouteFacts = { verifiedTargets: true, simulationOk: true, unlimitedApproval: false, supportedCapability: true }

  it('passes a clean route', () => {
    expect(disqualify(clean)).toBeNull()
  })

  it.each([
    ['an unverified contract', { verifiedTargets: false }, /no verified source/],
    ['a failed simulation', { simulationOk: false }, /simulation failed/],
    ['an unlimited approval', { unlimitedApproval: true }, /unlimited approval/],
    ['an unsupported capability', { supportedCapability: false }, /cannot sign/],
    ['a stale quote', { quoteExpiresAt: '2020-01-01T00:00:00Z' }, /quote has expired/],
  ] as const)('ends a route over %s', (_, facts, reason) => {
    expect(disqualify({ ...clean, ...facts })).toMatch(reason)
  })

  it('does not treat "no simulation ran" as a failure', () => {
    expect(disqualify({ ...clean, simulationOk: null })).toBeNull()
  })
})

describe('transfer eligibility', () => {
  it('refuses a watch-only wallet before anything else', () => {
    expect(transferIneligibility(wallet(1, { canSign: false, assetBalance: 0n }), usdcIntent, USDC, false)).toMatch(/watch-only/)
  })

  it('needs enough of the token, and says how short', () => {
    expect(transferIneligibility(wallet(1, { assetBalance: 12_000_000n }), usdcIntent, USDC, false)).toBe(
      'holds only 12 USDC on Base, short of 500 USDC',
    )
    expect(transferIneligibility(wallet(1, { assetBalance: 0n }), usdcIntent, USDC, false)).toBe('holds no USDC on Base')
  })

  it('needs something for gas on a token transfer', () => {
    expect(transferIneligibility(wallet(1, { gasBalance: 0n }), usdcIntent, USDC, false)).toMatch(/pay gas/)
  })

  it('needs strictly more than the amount for a native transfer, to leave gas', () => {
    const exact = wallet(1, { assetBalance: 10n ** 18n, gasBalance: 10n ** 18n })
    expect(transferIneligibility(exact, ethIntent, ETH, true)).toMatch(/still pay gas/)
    const more = wallet(1, { assetBalance: 10n ** 18n + 1n, gasBalance: 10n ** 18n + 1n })
    expect(transferIneligibility(more, ethIntent, ETH, true)).toBeNull()
  })
})

describe('resolveTransferWallet', () => {
  it('recommends the one eligible wallet, and says why the others lost', () => {
    const out = resolveTransferWallet({
      intent: usdcIntent,
      candidates: [wallet(1, { label: 'Main' }), wallet(2, { assetBalance: 0n }), wallet(3, { canSign: false })],
      asset: USDC,
      native: false,
    })
    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(out.walletId).toBe('w1')
    expect(out.resolution.account).toEqual({ caip10: wallet(1).account, label: 'Main' })
    expect(out.resolution.reason).toBe('Recommended Main (…0001) because it holds 1,000 USDC on Base, enough to send 500 USDC, has gas.')
    expect(out.resolution.candidatesConsidered.map((c) => c.reason)).toEqual([
      'holds no USDC on Base',
      'is watch-only and cannot sign',
    ])
  })

  it('breaks a tie by balance, and keeps a vault out of everyday sends', () => {
    const out = resolveTransferWallet({
      intent: usdcIntent,
      candidates: [
        wallet(1, { label: 'Daily', assetBalance: 600_000_000n }),
        wallet(2, { label: 'Vault', assetBalance: 50_000_000_000n }),
        wallet(3, { label: 'Trading', assetBalance: 900_000_000n }),
      ],
      asset: USDC,
      native: false,
    })
    if (!out.ok) throw new Error(out.reasons.join())
    expect(out.walletId).toBe('w3')
    expect(out.resolution.reason).toMatch(/of 3 wallets that could, it holds the most/)
    const reasons = Object.fromEntries(out.resolution.candidatesConsidered.map((c) => [c.label, c.reason]))
    expect(reasons.Vault).toMatch(/labelled Vault, which reads as not for everyday sends/)
    expect(reasons.Daily).toBe('holds 600 USDC on Base, less than Trading (…0003)')
  })

  /** 1 ETH + 1 wei against 2 ETH. A modulus tie-break got this wrong once. */
  it('compares whole balances, not a wrapped slice of them', () => {
    const out = resolveTransferWallet({
      intent: ethIntent,
      candidates: [
        wallet(1, { label: 'One', assetBalance: 10n ** 18n + 1n, gasBalance: 10n ** 18n + 1n }),
        wallet(2, { label: 'Two', assetBalance: 2n * 10n ** 18n, gasBalance: 2n * 10n ** 18n }),
      ],
      asset: ETH,
      native: true,
    })
    if (!out.ok) throw new Error(out.reasons.join())
    expect(out.walletId).toBe('w2')
    expect(out.resolution.reason).toMatch(/holds 2 ETH on Base/)
    expect(out.resolution.candidatesConsidered[0]!.reason).toBe('holds 1 ETH on Base, less than Two (…0002)')
  })

  it('lets a penalty outweigh any balance', () => {
    const out = resolveTransferWallet({
      intent: usdcIntent,
      candidates: [
        wallet(1, { label: 'Daily', assetBalance: 600_000_000n }),
        wallet(2, { label: 'Vault', assetBalance: 10n ** 30n }),
      ],
      asset: USDC,
      native: false,
    })
    if (!out.ok) throw new Error(out.reasons.join())
    expect(out.walletId).toBe('w1')
  })

  it('honours a chosen wallet and only checks it can', () => {
    const chosen = wallet(2, { label: 'Second', assetBalance: 700_000_000n })
    const out = resolveTransferWallet({
      intent: { ...usdcIntent, fromAccount: chosen.account },
      candidates: [wallet(1, { label: 'Main', assetBalance: 50_000_000_000n }), chosen],
      asset: USDC,
      native: false,
    })
    if (!out.ok) throw new Error(out.reasons.join())
    expect(out.walletId).toBe('w2')
    expect(out.resolution.reason).toBe('You chose Second (…0002). It holds 700 USDC on Base and has gas.')
    expect(out.resolution.candidatesConsidered[0]!.reason).toMatch(/you chose the wallet/)
  })

  it('refuses a chosen wallet that cannot, with the reason', () => {
    const chosen = wallet(2, { assetBalance: 1_000_000n })
    const out = resolveTransferWallet({
      intent: { ...usdcIntent, fromAccount: chosen.account },
      candidates: [wallet(1), chosen],
      asset: USDC,
      native: false,
    })
    expect(out).toEqual({ ok: false, reasons: ['the wallet ending …0002 holds only 1 USDC on Base, short of 500 USDC'] })
  })

  it('refuses a chosen account that is not linked', () => {
    const out = resolveTransferWallet({
      intent: { ...usdcIntent, fromAccount: `${CHAIN}:0x9999999999999999999999999999999999999999` },
      candidates: [wallet(1)],
      asset: USDC,
      native: false,
    })
    expect(!out.ok && out.reasons[0]).toMatch(/is not a linked wallet on Base/)
  })

  it('says why every wallet lost when none can', () => {
    const out = resolveTransferWallet({
      intent: usdcIntent,
      candidates: [wallet(1, { label: 'Main', assetBalance: 0n }), wallet(2, { canSign: false })],
      asset: USDC,
      native: false,
    })
    expect(out).toEqual({
      ok: false,
      reasons: ['Main (…0001) holds no USDC on Base', 'the wallet ending …0002 is watch-only and cannot sign'],
    })
  })

  it('names the chain when nothing is linked there at all', () => {
    const out = resolveTransferWallet({ intent: usdcIntent, candidates: [], asset: USDC, native: false })
    expect(out).toEqual({ ok: false, reasons: ['no linked wallet is on Base'] })
  })
})

describe('candidateName', () => {
  it('uses the label when there is one', () => {
    expect(candidateName({ label: 'Main', account: wallet(1).account })).toBe('Main (…0001)')
    expect(candidateName({ label: null, account: wallet(1).account })).toBe('the wallet ending …0001')
  })
})
