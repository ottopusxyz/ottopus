import { describe, expect, it } from 'vitest'
import type { PrivyWallet } from '../auth/privy.js'
import { MAX_ARMS, reconcile, type ExistingWallet } from './reconcile.js'

const address = (n: number) => `0x${n.toString(16).padStart(40, '0')}`

const attested = (overrides: Partial<PrivyWallet> & { address: string }): PrivyWallet => ({
  walletClientType: 'metamask',
  connectorType: 'injected',
  chainType: 'ethereum',
  firstVerifiedAt: '2026-09-01T10:00:00.000Z',
  ...overrides,
})

const existing = (overrides: Partial<ExistingWallet> & { address: string }): ExistingWallet => ({
  id: `id-${overrides.address}`,
  isWatchOnly: false,
  ...overrides,
})

describe('linking what Privy attests', () => {
  it('links a wallet that is attested but not stored', () => {
    const result = reconcile([], [attested({ address: address(1) })])
    expect(result.link).toHaveLength(1)
    expect(result.link[0]).toMatchObject({ address: address(1), namespace: 'eip155' })
    expect(result.unlink).toEqual([])
  })

  it('names the arm after the wallet client', () => {
    const result = reconcile([], [attested({ address: address(1), walletClientType: 'rabby' })])
    expect(result.link[0]?.walletType).toBe('rabby')
  })

  /** The label is shown to someone choosing which wallet signs. Never guess it. */
  it('says unknown rather than guessing a client', () => {
    const wallet = attested({ address: address(1) })
    delete wallet.walletClientType
    expect(reconcile([], [wallet]).link[0]?.walletType).toBe('unknown')
  })

  it('records the proof as an attestation, not a signature', () => {
    const proof = reconcile([], [attested({ address: address(1) })]).link[0]?.ownershipProof
    expect(proof?.via).toBe('privy_identity_token')
    expect(JSON.stringify(proof)).not.toContain('signature')
  })

  it('does nothing for a wallet already stored', () => {
    const result = reconcile([existing({ address: address(1) })], [attested({ address: address(1) })])
    expect(result).toEqual({ link: [], unlink: [], overflow: [] })
  })

  it('ignores a repeated address', () => {
    const result = reconcile([], [attested({ address: address(1) }), attested({ address: address(1) })])
    expect(result.link).toHaveLength(1)
  })
})

describe('unlinking what Privy no longer attests', () => {
  /** Unlinking in Privy has to reach us, or a revoked wallet keeps signing. */
  it('unlinks a stored wallet that is no longer attested', () => {
    const result = reconcile([existing({ address: address(1) })], [])
    expect(result.unlink).toEqual([`id-${address(1)}`])
  })

  /**
   * The one that would quietly destroy data. Watch-only arms are unprovable by
   * definition, so Privy can never attest them — treating absence as removal
   * would unlink every pasted address on the next sync.
   */
  it('never unlinks a watch-only wallet', () => {
    const result = reconcile([existing({ address: address(9), isWatchOnly: true })], [])
    expect(result.unlink).toEqual([])
  })

  it('unlinks one and links another in the same pass', () => {
    const result = reconcile([existing({ address: address(1) })], [attested({ address: address(2) })])
    expect(result.unlink).toEqual([`id-${address(1)}`])
    expect(result.link.map((w) => w.address)).toEqual([address(2)])
  })
})

describe('wallets Ottopus will not take', () => {
  /**
   * A Privy embedded wallet is a key Privy holds for the user inside our
   * product. The web app disables creating them; this covers one arriving
   * anyway.
   */
  it.each(['privy', 'privy-v2'])('skips a %s embedded wallet', (client) => {
    const result = reconcile([], [attested({ address: address(1), walletClientType: client })])
    expect(result.link).toEqual([])
  })

  it('skips a chain nothing downstream can plan for', () => {
    const result = reconcile([], [attested({ address: address(1), chainType: 'solana' })])
    expect(result.link).toEqual([])
  })

  /** An absent chain_type predates multi-chain, when everything was Ethereum. */
  it('assumes ethereum when the chain type is missing', () => {
    const wallet = attested({ address: address(1) })
    delete wallet.chainType
    expect(reconcile([], [wallet]).link).toHaveLength(1)
  })

  /**
   * A skipped wallet is not an unlink. Storing a Solana address once and
   * filtering it out on the next pass must not then delete it.
   */
  it('does not unlink a stored wallet just because its attestation is skipped', () => {
    const result = reconcile(
      [existing({ address: address(1) })],
      [attested({ address: address(1), chainType: 'solana' })],
    )
    expect(result.unlink).toEqual([])
  })
})

describe('the cap', () => {
  const eight = Array.from({ length: MAX_ARMS }, (_, i) => existing({ address: address(i) }))

  it('links nothing when the arms are full', () => {
    const result = reconcile(eight, [...eight.map((w) => attested({ address: w.address })), attested({ address: address(99) })])
    expect(result.link).toEqual([])
    expect(result.overflow).toEqual([address(99)])
  })

  it('reports overflow rather than dropping it silently', () => {
    const result = reconcile(
      [],
      Array.from({ length: 10 }, (_, i) =>
        attested({ address: address(i), firstVerifiedAt: `2026-09-0${i % 9}T10:00:00.000Z` }),
      ),
    )
    expect(result.link).toHaveLength(MAX_ARMS)
    expect(result.overflow).toHaveLength(2)
  })

  /** Watch-only arms are not free — they occupy a slot like anything else. */
  it('counts watch-only wallets against the cap', () => {
    const full = Array.from({ length: MAX_ARMS }, (_, i) =>
      existing({ address: address(i), isWatchOnly: true }),
    )
    expect(reconcile(full, [attested({ address: address(99) })]).link).toEqual([])
  })

  /** Swapping at the cap is legal: the freed slot is available in the same pass. */
  it('lets an unlink make room for a link', () => {
    const result = reconcile(eight, [
      ...eight.slice(1).map((w) => attested({ address: w.address })),
      attested({ address: address(99) }),
    ])
    expect(result.unlink).toEqual([`id-${address(0)}`])
    expect(result.link.map((w) => w.address)).toEqual([address(99)])
  })

  it('keeps the oldest links when it has to choose', () => {
    const result = reconcile(
      [],
      [
        attested({ address: address(2), firstVerifiedAt: '2026-09-05T10:00:00.000Z' }),
        attested({ address: address(1), firstVerifiedAt: '2026-09-01T10:00:00.000Z' }),
      ],
    )
    expect(result.link.map((w) => w.address)).toEqual([address(1), address(2)])
  })
})
