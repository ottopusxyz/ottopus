import * as jose from 'jose'

/**
 * Privy access-token verification.
 *
 * Offline, against the app's public verification key: no network call on the
 * hot path, no app secret to hold, and nothing to be down when Privy is. The
 * key is a public ES256 key from the Privy dashboard — safe in an environment
 * variable in a way an app secret is not.
 *
 * Two tokens, two jobs. The **access** token is the credential and answers "who
 * is calling" — `sub`, and nothing else. The **identity** token is an assertion
 * about that user, and carries the `linked_accounts` claim.
 *
 * Both are signed by the same public ES256 key, which is what makes the wallet
 * addresses in `linked_accounts` usable server-side. They are not a client
 * claim: the browser cannot mint one, so a caller cannot name an address they
 * do not control. What they are is *Privy's* attestation — Privy ran the
 * EIP-4361 exchange (`/siwe/init` for the nonce, `/siwe/link` to verify the
 * signature) and is telling us it passed. See wallets/reconcile.ts for what
 * that does and does not buy.
 */

export class PrivyAuthError extends Error {}

/**
 * Says why a verification key is unusable, or null when it looks fine.
 *
 * The dashboard hands you a multi-line PEM, and pasting that straight into a
 * .env without quotes leaves `-----BEGIN PUBLIC KEY-----` and nothing else —
 * the parser stops at the first newline. That failure otherwise surfaces as
 * every request returning 401, which sends you looking at tokens instead of at
 * the one line of config that is actually wrong.
 */
export function keyProblem(raw: string | undefined): string | null {
  const key = (raw ?? '').trim()
  if (!key) return 'not set'
  if (key.startsWith('{')) {
    try {
      JSON.parse(key)
      return null
    } catch {
      return 'looks like a JWK but is not valid JSON'
    }
  }
  const hasBegin = key.includes('BEGIN PUBLIC KEY')
  const hasEnd = key.includes('END PUBLIC KEY')
  if (hasBegin && !hasEnd) {
    return 'truncated after the BEGIN line — quote the value in .env ("-----BEGIN…"), or put it on one line with \\n escapes'
  }
  if (!hasBegin && !hasEnd && key.length < 40) {
    return `too short to be a public key (${key.length} characters)`
  }
  return null
}

export interface PrivyClaims {
  /** The user's Privy DID, e.g. did:privy:xxxxx. The join key on users. */
  did: string
  /** Seconds since the epoch. */
  expiresAt: number
}

/**
 * A wallet Privy says this user has linked and proved.
 *
 * Field names mirror the claim, not our schema — the mapping onto an arm is
 * the wallets module's job, so a change in Privy's shape lands in one place.
 */
export interface PrivyWallet {
  /** Lowercased here, because every comparison downstream is lowercase. */
  address: string
  /** metamask, rabby, coinbase_wallet, privy — this is what names the arm. */
  walletClientType?: string
  /** injected, wallet_connect — how it was reached, not what it is. */
  connectorType?: string
  /** 'ethereum' or 'solana'. Anything but ethereum is skipped for now. */
  chainType?: string
  /** When Privy first verified it, as an ISO string. */
  firstVerifiedAt?: string
  /** When Privy last saw it prove itself. */
  latestVerifiedAt?: string
}

/** What an identity token tells us: who you are called, and what you linked. */
export interface PrivyIdentity {
  did: string
  email?: string
  name?: string
  wallets: PrivyWallet[]
}

export interface PrivyVerifierConfig {
  appId: string
  /** SPKI PEM or a JWK, as the dashboard gives it. */
  verificationKey: string
}

/**
 * Privy issues ES256. Pinning the algorithm matters: without it a token could
 * name its own, and "none" or an HMAC over the public key would both verify.
 */
const ALGORITHM = 'ES256'

export type PrivyVerifier = (token: string) => Promise<PrivyClaims>

export interface PrivyAuth {
  /** The credential. Proves who is calling, and nothing else. */
  verifyAccess: PrivyVerifier
  /**
   * The profile and the linked wallets. Signed by the same key, so everything
   * in it is attested by Privy rather than typed by the caller.
   */
  readIdentity: (token: string) => Promise<PrivyIdentity>
}

/**
 * The claim is documented only as "a lightweight version of linkedAccounts",
 * and the SDK's own types are camelCase while the JWT is snake_case. Both
 * spellings are read rather than betting on one — the same reason `nameOf`
 * below does, and the cost of guessing wrong is a wallet that silently never
 * syncs.
 */
interface LinkedAccount {
  type?: string
  address?: string
  email?: string
  name?: string
  first_name?: string
  last_name?: string
  username?: string
  wallet_client_type?: string
  walletClientType?: string
  connector_type?: string
  connectorType?: string
  chain_type?: string
  chainType?: string
  first_verified_at?: string | number
  firstVerifiedAt?: string | number
  latest_verified_at?: string | number
  latestVerifiedAt?: string | number
}

/** Privy sends these as ISO strings and as epoch seconds, depending on age. */
function timestampOf(value: string | number | undefined): string | undefined {
  if (value === undefined) return undefined
  const date = typeof value === 'number' ? new Date(value * 1000) : new Date(value)
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString()
}

/**
 * A person's name, however the provider chose to spell it. Privy calls the
 * claim "a lightweight version of linkedAccounts" without pinning the shape, so
 * this reads the plausible spellings rather than betting on one.
 */
function nameOf(account: LinkedAccount): string | undefined {
  if (account.name) return account.name
  const full = [account.first_name, account.last_name].filter(Boolean).join(' ').trim()
  return full || account.username || undefined
}

/** Privy has encoded this as a JSON string and as an array, depending on age. */
function linkedAccounts(raw: unknown): LinkedAccount[] {
  if (Array.isArray(raw)) return raw as LinkedAccount[]
  if (typeof raw === 'string') {
    try {
      const parsed: unknown = JSON.parse(raw)
      return Array.isArray(parsed) ? (parsed as LinkedAccount[]) : []
    } catch {
      return []
    }
  }
  return []
}

/**
 * The key is parsed once and reused. Import is the expensive part, and it
 * cannot fail differently per request — if the key is malformed, every call
 * should say the same thing.
 */
export function createPrivyAuth({ appId, verificationKey }: PrivyVerifierConfig): PrivyAuth {
  // jose's own key type — a CryptoKey here, but importJWK widens it. Named
  // from the library rather than from the DOM lib, which this package does not
  // pull in.
  type Key = Awaited<ReturnType<typeof jose.importJWK>>

  const load = async (): Promise<Key> => {
    // A single-line PEM with escaped newlines is how this value survives most
    // secret stores, so unescape before anything else looks at it.
    const trimmed = verificationKey.trim().replace(/\\n/g, '\n')
    // The dashboard gives either shape depending on where you copy from.
    if (trimmed.startsWith('{')) return jose.importJWK(JSON.parse(trimmed), ALGORITHM)
    const pem = trimmed.includes('BEGIN PUBLIC KEY')
      ? trimmed
      : `-----BEGIN PUBLIC KEY-----\n${trimmed}\n-----END PUBLIC KEY-----`
    return jose.importSPKI(pem, ALGORITHM)
  }

  let keyPromise: Promise<Key> | undefined
  const key = () => (keyPromise ??= load())

  const claims = async (token: string): Promise<jose.JWTPayload> => {
    try {
      const result = await jose.jwtVerify(token, await key(), {
        algorithms: [ALGORITHM],
        issuer: 'privy.io',
        audience: appId,
      })
      return result.payload
    } catch (err) {
      // One message for every failure. jose's error name says which check
      // failed — expired, bad signature, wrong audience — and putting that in
      // the message would leak it through any layer that logs or returns it.
      // The detail survives as `cause` for server-side logs, which is where
      // knowing the difference is actually useful.
      throw new PrivyAuthError('Token rejected', { cause: err })
    }
  }

  const didOf = (payload: jose.JWTPayload): string => {
    const did = payload.sub
    if (typeof did !== 'string' || !did.startsWith('did:privy:')) {
      throw new PrivyAuthError('Token rejected', { cause: 'subject is not a Privy DID' })
    }
    return did
  }

  return {
    async verifyAccess(token: string): Promise<PrivyClaims> {
      const payload = await claims(token)
      const did = didOf(payload)
      if (typeof payload.exp !== 'number') {
        throw new PrivyAuthError('Token rejected', { cause: 'no expiry' })
      }
      return { did, expiresAt: payload.exp }
    },

    async readIdentity(token: string): Promise<PrivyIdentity> {
      const payload = await claims(token)
      const did = didOf(payload)
      const accounts = linkedAccounts(payload.linked_accounts)

      // A wallet's `address` is an account, not an inbox — reading names and
      // email from wallet entries would put "0xabc…" in the name column.
      const people = accounts.filter((a) => a.type !== 'wallet')
      const named = people.map(nameOf).find(Boolean)
      const mailed = people.find((a) => a.email)?.email
      const emailAccount = accounts.find((a) => a.type === 'email' && a.address)?.address

      const wallets = accounts
        .filter((a) => a.type === 'wallet' && typeof a.address === 'string' && a.address)
        .map(
          (a): PrivyWallet => ({
            address: a.address!.toLowerCase(),
            walletClientType: a.wallet_client_type ?? a.walletClientType,
            connectorType: a.connector_type ?? a.connectorType,
            chainType: a.chain_type ?? a.chainType,
            firstVerifiedAt: timestampOf(a.first_verified_at ?? a.firstVerifiedAt),
            latestVerifiedAt: timestampOf(a.latest_verified_at ?? a.latestVerifiedAt),
          }),
        )

      return { did, name: named, email: mailed ?? emailAccount, wallets }
    },
  }
}

/** `Authorization: Bearer <token>`, or null. The scheme is case-insensitive
 * per RFC 7235, and clients do send "bearer". */
export function bearerToken(header: string | undefined | null): string | null {
  if (!header) return null
  const match = /^Bearer +([A-Za-z0-9._~+/-]+=*)$/i.exec(header.trim())
  return match ? match[1]! : null
}
