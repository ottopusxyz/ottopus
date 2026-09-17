import * as jose from 'jose'
import { beforeAll, describe, expect, it } from 'vitest'
import { PrivyAuthError, bearerToken, createPrivyVerifier } from './privy.js'

/**
 * Real ES256 keys, generated per run. Verification is the boundary between
 * "someone says they are a user" and "someone is a user", so it is tested
 * against actual signatures rather than a stub that always agrees.
 */
const APP_ID = 'test-app-id'
const DID = 'did:privy:abc123'

let key: CryptoKeyPair
let otherKey: CryptoKeyPair
let spki: string

beforeAll(async () => {
  key = (await jose.generateKeyPair('ES256', { extractable: true })) as CryptoKeyPair
  otherKey = (await jose.generateKeyPair('ES256', { extractable: true })) as CryptoKeyPair
  spki = await jose.exportSPKI(key.publicKey)
})

interface TokenOverrides {
  sub?: string
  aud?: string
  iss?: string
  expiresIn?: string
  signWith?: CryptoKeyPair
}

async function token(overrides: TokenOverrides = {}): Promise<string> {
  const { sub = DID, aud = APP_ID, iss = 'privy.io', expiresIn = '1h', signWith = key } = overrides
  return new jose.SignJWT({})
    .setProtectedHeader({ alg: 'ES256' })
    .setSubject(sub)
    .setAudience(aud)
    .setIssuer(iss)
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .sign(signWith.privateKey)
}

const verifier = () => createPrivyVerifier({ appId: APP_ID, verificationKey: spki })

describe('access token verification', () => {
  it('accepts a well-formed token and returns the DID', async () => {
    const claims = await verifier()(await token())
    expect(claims.did).toBe(DID)
    expect(claims.expiresAt).toBeGreaterThan(Math.floor(Date.now() / 1000))
  })

  it('rejects a token signed by someone else', async () => {
    await expect(verifier()(await token({ signWith: otherKey }))).rejects.toBeInstanceOf(
      PrivyAuthError,
    )
  })

  it('rejects an expired token', async () => {
    await expect(verifier()(await token({ expiresIn: '-1s' }))).rejects.toBeInstanceOf(
      PrivyAuthError,
    )
  })

  /** A token minted for another Privy app must not open this one. */
  it('rejects a token for a different audience', async () => {
    await expect(verifier()(await token({ aud: 'someone-elses-app' }))).rejects.toBeInstanceOf(
      PrivyAuthError,
    )
  })

  it('rejects a token from a different issuer', async () => {
    await expect(verifier()(await token({ iss: 'evil.example' }))).rejects.toBeInstanceOf(
      PrivyAuthError,
    )
  })

  it('rejects a subject that is not a Privy DID', async () => {
    await expect(verifier()(await token({ sub: 'someone' }))).rejects.toBeInstanceOf(
      PrivyAuthError,
    )
  })

  it('rejects tampered payloads', async () => {
    const [header, , signature] = (await token()).split('.')
    const forged = jose.base64url.encode(
      JSON.stringify({ sub: 'did:privy:someone-else', aud: APP_ID, iss: 'privy.io' }),
    )
    await expect(verifier()(`${header}.${forged}.${signature}`)).rejects.toBeInstanceOf(
      PrivyAuthError,
    )
  })

  /**
   * "alg": "none" is the oldest JWT attack there is, and the algorithm pin in
   * the verifier is the only thing standing in front of it.
   */
  it('rejects an unsigned token claiming alg none', async () => {
    const unsigned = new jose.UnsecuredJWT({})
      .setSubject(DID)
      .setAudience(APP_ID)
      .setIssuer('privy.io')
      .encode()
    await expect(verifier()(unsigned)).rejects.toBeInstanceOf(PrivyAuthError)
  })

  it('never says why a token failed', async () => {
    const reasons = await Promise.all(
      [token({ expiresIn: '-1s' }), token({ signWith: otherKey })].map((t) =>
        t.then((raw) => verifier()(raw).catch((e: Error) => e.message)),
      ),
    )
    for (const reason of reasons) {
      expect(reason).not.toMatch(/expired|signature|audience/i)
    }
  })
})

describe('bearerToken', () => {
  it('reads a bearer token', () => {
    expect(bearerToken('Bearer abc.def.ghi')).toBe('abc.def.ghi')
  })

  it('is case-insensitive on the scheme', () => {
    expect(bearerToken('bearer abc.def.ghi')).toBe('abc.def.ghi')
  })

  it('ignores other schemes and junk', () => {
    expect(bearerToken('Basic abc')).toBeNull()
    expect(bearerToken('abc.def.ghi')).toBeNull()
    expect(bearerToken(undefined)).toBeNull()
    expect(bearerToken('')).toBeNull()
  })
})
