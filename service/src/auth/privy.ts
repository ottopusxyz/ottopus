import * as jose from 'jose'

/**
 * Privy access-token verification.
 *
 * Offline, against the app's public verification key: no network call on the
 * hot path, no app secret to hold, and nothing to be down when Privy is. The
 * key is a public ES256 key from the Privy dashboard — safe in an environment
 * variable in a way an app secret is not.
 *
 * The **access** token, never the identity token. The identity token carries a
 * `linked_accounts` claim including wallet addresses, and reading a wallet from
 * a token would route straight around the server-issued ownership challenge in
 * #7. The only thing taken from here is `sub`, the user's Privy DID.
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

/**
 * The key is parsed once and reused. Import is the expensive part, and it
 * cannot fail differently per request — if the key is malformed, every call
 * should say the same thing.
 */
export function createPrivyVerifier({
  appId,
  verificationKey,
}: PrivyVerifierConfig): PrivyVerifier {
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

  return async function verify(token: string): Promise<PrivyClaims> {
    let payload: jose.JWTPayload
    try {
      const result = await jose.jwtVerify(token, await key(), {
        algorithms: [ALGORITHM],
        issuer: 'privy.io',
        audience: appId,
      })
      payload = result.payload
    } catch (err) {
      // One message for every failure. jose's error name says which check
      // failed — expired, bad signature, wrong audience — and putting that in
      // the message would leak it through any layer that logs or returns it.
      // The detail survives as `cause` for server-side logs, which is where
      // knowing the difference is actually useful.
      throw new PrivyAuthError('Token rejected', { cause: err })
    }

    const did = payload.sub
    if (typeof did !== 'string' || !did.startsWith('did:privy:')) {
      throw new PrivyAuthError('Token rejected', { cause: 'subject is not a Privy DID' })
    }
    if (typeof payload.exp !== 'number') {
      throw new PrivyAuthError('Token rejected', { cause: 'no expiry' })
    }

    return { did, expiresAt: payload.exp }
  }
}

/** `Authorization: Bearer <token>`, or null. The scheme is case-insensitive
 * per RFC 7235, and clients do send "bearer". */
export function bearerToken(header: string | undefined | null): string | null {
  if (!header) return null
  const match = /^Bearer +([A-Za-z0-9._~+/-]+=*)$/i.exec(header.trim())
  return match ? match[1]! : null
}
