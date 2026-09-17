import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'

/**
 * Opaque tokens, and the hashing that keeps a leaked table useless.
 *
 * Tokens are random strings rather than JWTs. A JWT would be verifiable without
 * a round trip, which is the usual reason to reach for one — but it is also
 * revocable only by keeping a deny-list, and revocation is a product feature
 * here: Settings exposes it, and a grant a person revoked must stop working
 * immediately rather than at its next expiry.
 */

/** 256 bits. The value the client sees; only its hash is ever stored. */
export function mintSecret(): string {
  return randomBytes(32).toString('base64url')
}

/**
 * SHA-256, base64url. Not a password hash on purpose — these are 256-bit
 * random strings, so there is nothing to brute-force and a slow KDF would only
 * add latency to every single MCP request.
 */
export function hashSecret(secret: string): string {
  return createHash('sha256').update(secret).digest('base64url')
}

/** Constant-time compare for anything derived from a secret. */
export function sameSecret(a: string, b: string): boolean {
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  if (left.length !== right.length) return false
  return timingSafeEqual(left, right)
}

/**
 * PKCE S256 verification.
 *
 * S256 only. `plain` is still in the RFC but forbidden by OAuth 2.1 for public
 * clients, and the database has a check constraint saying the same thing — so a
 * downgrade cannot be smuggled in through a challenge method we happen to
 * accept here.
 */
export function verifyPkce(verifier: string, challenge: string): boolean {
  // RFC 7636 puts the verifier between 43 and 128 characters. A short one is
  // not a formatting quibble: it is the entire strength of the exchange.
  if (verifier.length < 43 || verifier.length > 128) return false
  return sameSecret(createHash('sha256').update(verifier).digest('base64url'), challenge)
}
