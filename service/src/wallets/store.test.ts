import { PGlite } from '@electric-sql/pglite'
import { drizzle } from 'drizzle-orm/pglite'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { PrivyWallet } from '../auth/privy.js'
import { migrationFiles, statementsIn } from '../db/migrate.js'
import * as schema from '../db/schema.js'
import { userIdForDid } from '../auth/session.js'
import { MAX_ARMS } from './reconcile.js'
import { WalletError, addWatchOnlyWallet, listWallets, syncWallets, unlinkWallet } from './store.js'

/**
 * Against real Postgres. The parts worth testing here are the ones the
 * database enforces — the partial unique index on active arms, the check that
 * a signer carries proof — and a mock would simply agree with us.
 */
let db: ReturnType<typeof drizzle<typeof schema>>
let pg: PGlite
let userId: string
let otherId: string

const address = (n: number) => `0x${n.toString(16).padStart(40, '0')}`

const attested = (n: number, overrides: Partial<PrivyWallet> = {}): PrivyWallet => ({
  address: address(n),
  walletClientType: 'metamask',
  connectorType: 'injected',
  chainType: 'ethereum',
  firstVerifiedAt: '2026-09-01T10:00:00.000Z',
  ...overrides,
})

beforeAll(async () => {
  pg = await PGlite.create()
  await pg.exec(`create role anon; create role authenticated; create role service_role;`)
  for (const file of await migrationFiles(new URL('../../drizzle', import.meta.url).pathname)) {
    for (const stmt of await statementsIn(file)) await pg.exec(stmt)
  }
  db = drizzle(pg, { schema, casing: 'snake_case' })
  userId = await userIdForDid(db, 'did:privy:wallet-owner')
  otherId = await userIdForDid(db, 'did:privy:someone-else')
}, 60_000)

beforeEach(async () => {
  await pg.exec(`delete from linked_wallets`)
})

describe('syncing from an attestation', () => {
  it('stores an attested wallet as a proven arm', async () => {
    const { wallets } = await syncWallets(db, userId, [attested(1)])
    expect(wallets).toHaveLength(1)
    expect(wallets[0]).toMatchObject({
      address: address(1),
      walletType: 'metamask',
      isWatchOnly: false,
    })
    expect(wallets[0]?.provedAt).not.toBeNull()
  })

  /** Called on every cold boot, so this is the common case, not an edge one. */
  it('changes nothing when called again', async () => {
    const first = await syncWallets(db, userId, [attested(1)])
    const second = await syncWallets(db, userId, [attested(1)])
    expect(second.wallets).toEqual(first.wallets)
  })

  it('unlinks an arm Privy no longer attests', async () => {
    await syncWallets(db, userId, [attested(1)])
    const { wallets } = await syncWallets(db, userId, [])
    expect(wallets).toEqual([])
  })

  /** Soft delete: the row survives so a plan can still point at it. */
  it('keeps the unlinked row', async () => {
    await syncWallets(db, userId, [attested(1)])
    await syncWallets(db, userId, [])
    const r = await pg.query<{ n: number }>(
      `select count(*)::int as n from linked_wallets where unlinked_at is not null`,
    )
    expect(r.rows[0]!.n).toBe(1)
  })

  /**
   * The partial unique index only covers active arms, so re-linking must not
   * collide with the tombstone left by the last unlink.
   */
  it('re-links an address that was unlinked before', async () => {
    await syncWallets(db, userId, [attested(1)])
    await syncWallets(db, userId, [])
    const { wallets } = await syncWallets(db, userId, [attested(1)])
    expect(wallets).toHaveLength(1)
  })

  it('never touches another user’s arms', async () => {
    await syncWallets(db, otherId, [attested(1)])
    await syncWallets(db, userId, [])
    expect(await listWallets(db, otherId)).toHaveLength(1)
  })

  it('reports what did not fit rather than dropping it', async () => {
    const many = Array.from({ length: MAX_ARMS + 2 }, (_, i) => attested(i))
    const { wallets, overflow } = await syncWallets(db, userId, many)
    expect(wallets).toHaveLength(MAX_ARMS)
    expect(overflow).toHaveLength(2)
  })
})

describe('watch-only wallets', () => {
  it('stores a pasted address with no proof', async () => {
    const arm = await addWatchOnlyWallet(db, userId, { address: address(5), label: 'Treasury' })
    expect(arm).toMatchObject({ isWatchOnly: true, label: 'Treasury', walletType: 'watch_only' })
    expect(arm.provedAt).toBeNull()
  })

  it('names a Safe as one', async () => {
    const arm = await addWatchOnlyWallet(db, userId, { address: address(5), walletType: 'safe' })
    expect(arm.walletType).toBe('safe')
    expect(arm.isWatchOnly).toBe(true)
  })

  it('lowercases a checksummed address', async () => {
    const arm = await addWatchOnlyWallet(db, userId, {
      address: '0xAbC0000000000000000000000000000000000001',
    })
    expect(arm.address).toBe('0xabc0000000000000000000000000000000000001')
  })

  it.each(['0x123', 'not-an-address', '', address(1) + 'ff'])('rejects %s', async (bad) => {
    await expect(addWatchOnlyWallet(db, userId, { address: bad })).rejects.toThrow(WalletError)
  })

  it('refuses a duplicate with a reason, not a constraint error', async () => {
    await addWatchOnlyWallet(db, userId, { address: address(5) })
    await expect(addWatchOnlyWallet(db, userId, { address: address(5) })).rejects.toMatchObject({
      code: 'already_linked',
    })
  })

  it('refuses a ninth arm', async () => {
    for (let i = 0; i < MAX_ARMS; i++) await addWatchOnlyWallet(db, userId, { address: address(i) })
    await expect(addWatchOnlyWallet(db, userId, { address: address(99) })).rejects.toMatchObject({
      code: 'too_many_wallets',
    })
  })

  /**
   * The one that would quietly destroy data: a sync is a full snapshot, and
   * Privy can never attest a wallet nobody proved.
   */
  it('survives a sync that attests nothing', async () => {
    await addWatchOnlyWallet(db, userId, { address: address(5) })
    const { wallets } = await syncWallets(db, userId, [])
    expect(wallets.map((w) => w.address)).toEqual([address(5)])
  })

  it('counts against the cap when syncing', async () => {
    for (let i = 0; i < MAX_ARMS; i++) await addWatchOnlyWallet(db, userId, { address: address(i) })
    const { overflow } = await syncWallets(db, userId, [attested(99)])
    expect(overflow).toEqual([address(99)])
  })
})

describe('unlinking', () => {
  it('removes the arm from the active list', async () => {
    const arm = await addWatchOnlyWallet(db, userId, { address: address(5) })
    await unlinkWallet(db, userId, arm.id)
    expect(await listWallets(db, userId)).toEqual([])
  })

  /** Someone else's wallet and a wallet that does not exist answer the same. */
  it('refuses to unlink a wallet belonging to someone else', async () => {
    const arm = await addWatchOnlyWallet(db, otherId, { address: address(5) })
    await expect(unlinkWallet(db, userId, arm.id)).rejects.toMatchObject({ code: 'not_found' })
    expect(await listWallets(db, otherId)).toHaveLength(1)
  })

  it('is not repeatable', async () => {
    const arm = await addWatchOnlyWallet(db, userId, { address: address(5) })
    await unlinkWallet(db, userId, arm.id)
    await expect(unlinkWallet(db, userId, arm.id)).rejects.toMatchObject({ code: 'not_found' })
  })

  /**
   * Unlinking here does not unlink at Privy, so a wallet still attested comes
   * back on the next sync. The web app has to unlink at Privy first — this
   * test exists so that behaviour is deliberate rather than discovered.
   */
  it('lets a still-attested wallet return on the next sync', async () => {
    const { wallets } = await syncWallets(db, userId, [attested(1)])
    await unlinkWallet(db, userId, wallets[0]!.id)
    expect(await listWallets(db, userId)).toEqual([])
    const after = await syncWallets(db, userId, [attested(1)])
    expect(after.wallets).toHaveLength(1)
  })
})
