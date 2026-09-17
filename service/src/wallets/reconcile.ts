import type { PrivyWallet } from '../auth/privy.js'

/**
 * Working out which arms to add and which to drop, given what Privy attests.
 *
 * Pure on purpose. This is the function that decides a wallet stops being
 * usable, and "did it unlink the right one" is a question worth answering
 * without a database in the way.
 *
 * ## What Privy's attestation is worth
 *
 * Privy ran EIP-4361 against our own origin: it issued the nonce, the wallet
 * signed with `personal_sign`, and Privy verified the signature server-side.
 * That is a real ownership proof and it is the same protocol we would have
 * written. What differs is who checked it — we are trusting Privy's word,
 * carried in a token signed by a key we hold.
 *
 * That trust is not new. Privy already decides who is signed in at all, so a
 * compromised Privy could mint a session long before it could forge a wallet.
 * It does mean the stored proof records the attestation, not a signature, and
 * `ownership_proof` says so — an audit that assumed we had the raw signature
 * would otherwise be reading something that was never there.
 */

/** Otto has eight arms. The product is built around that and so is this. */
export const MAX_ARMS = 8

/** An arm as it exists today. Only the fields the decision needs. */
export interface ExistingWallet {
  id: string
  address: string
  isWatchOnly: boolean
}

/** A wallet to insert, already shaped for the row. */
export interface WalletToLink {
  address: string
  namespace: string
  walletType: string
  provedAt: Date
  ownershipProof: {
    /**
     * Never "signature". The distinction matters to anyone auditing why a
     * wallet was trusted: we hold Privy's word, not the signed message.
     */
    via: 'privy_identity_token'
    connectorType?: string
    firstVerifiedAt?: string
    latestVerifiedAt?: string
  }
}

export interface Reconciliation {
  link: WalletToLink[]
  /** Ids to soft-unlink: attested once, not attested now. */
  unlink: string[]
  /**
   * Attested wallets that did not fit under the cap. Reported rather than
   * dropped silently — the person linked these and deserves to be told which
   * ones did not make it, not to go looking for a wallet that never appeared.
   */
  overflow: string[]
}

/**
 * Privy's own embedded wallets are skipped.
 *
 * The key is held by Privy on the user's behalf, which is close enough to the
 * thing Ottopus promises not to do that the app disables them at creation
 * (see `embeddedWallets.createOnLogin` in the web provider). Skipping here
 * covers the case where one exists anyway — imported from another Privy app,
 * or created before that setting.
 */
const EMBEDDED = new Set(['privy', 'privy-v2'])

/**
 * Chain type to CAIP namespace. Solana wallets are attested the same way and
 * are perfectly real, but nothing downstream — routing, simulation, decoding —
 * handles them yet, and linking one would show an arm that no plan can use.
 */
const NAMESPACE_BY_CHAIN: Readonly<Record<string, string>> = {
  ethereum: 'eip155',
}

/** Sortable, and undefined sorts last so dated links win a contested slot. */
function linkedAt(wallet: PrivyWallet): number {
  const raw = wallet.firstVerifiedAt ?? wallet.latestVerifiedAt
  if (!raw) return Number.MAX_SAFE_INTEGER
  const time = new Date(raw).getTime()
  return Number.isNaN(time) ? Number.MAX_SAFE_INTEGER : time
}

/**
 * `attested` is the complete set of wallets Privy says this user has linked —
 * it is a snapshot, not a delta, which is what lets an absent address mean
 * "unlinked" rather than "not mentioned".
 *
 * Callers must therefore never pass an empty array to mean "we did not ask".
 * See `privyWallets` in the session middleware, where undefined carries that.
 */
export function reconcile(existing: ExistingWallet[], attested: PrivyWallet[]): Reconciliation {
  const usable = attested
    .filter((w) => !EMBEDDED.has(w.walletClientType ?? ''))
    // An absent chain_type predates Privy's multi-chain support, when every
    // wallet was Ethereum. Defaulting to that beats dropping the wallet.
    .filter((w) => NAMESPACE_BY_CHAIN[w.chainType ?? 'ethereum'] !== undefined)

  // Last entry wins if Privy ever repeats an address; the sort below then
  // orders what survives, so the result does not depend on claim order.
  const byAddress = new Map(usable.map((w) => [w.address, w]))

  /**
   * Deliberately the *unfiltered* set. "Should we link this" and "is this still
   * linked" are different questions, and the filters above only answer the
   * first. Asking the filtered set would unlink a stored wallet the moment its
   * attestation became unusable — switch a linked wallet to Solana and the arm
   * would vanish, having been proved and never revoked.
   */
  const stillAttested = new Set(attested.map((w) => w.address))

  /**
   * Watch-only arms are invisible to Privy — nobody proved them, which is the
   * point of them — so they can never appear in `attested` and must never be
   * unlinked for being absent. They still occupy a slot.
   */
  const unlink = existing
    .filter((w) => !w.isWatchOnly && !stillAttested.has(w.address))
    .map((w) => w.id)

  const known = new Set(existing.map((w) => w.address))
  const fresh = [...byAddress.values()]
    .filter((w) => !known.has(w.address))
    .sort((a, b) => linkedAt(a) - linkedAt(b) || a.address.localeCompare(b.address))

  // Capacity counts arms that survive this pass, not arms that exist now:
  // unlinking three and linking three is a valid no-op at the cap.
  const remaining = MAX_ARMS - (existing.length - unlink.length)

  const link = fresh.slice(0, Math.max(0, remaining)).map(
    (w): WalletToLink => ({
      address: w.address,
      namespace: NAMESPACE_BY_CHAIN[w.chainType ?? 'ethereum']!,
      // The wallet client names the arm — "MetaMask", "Rabby". Unknown rather
      // than a guess: the label is shown to a person choosing which to sign with.
      walletType: w.walletClientType ?? 'unknown',
      provedAt: new Date(linkedAt(w) === Number.MAX_SAFE_INTEGER ? Date.now() : linkedAt(w)),
      ownershipProof: {
        via: 'privy_identity_token',
        connectorType: w.connectorType,
        firstVerifiedAt: w.firstVerifiedAt,
        latestVerifiedAt: w.latestVerifiedAt,
      },
    }),
  )

  return { link, unlink, overflow: fresh.slice(Math.max(0, remaining)).map((w) => w.address) }
}
