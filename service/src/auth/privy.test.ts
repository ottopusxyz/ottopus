import * as jose from 'jose'
import { beforeAll, describe, expect, it } from 'vitest'
import { PrivyAuthError, bearerToken, createPrivyAuth } from './privy.js'

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

const auth = () => createPrivyAuth({ appId: APP_ID, verificationKey: spki })
const verifier = () => auth().verifyAccess

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

describe('identity tokens carry a name and the linked wallets', () => {
  const identity = async (accounts: unknown) =>
    new jose.SignJWT({ linked_accounts: accounts })
      .setProtectedHeader({ alg: 'ES256' })
      .setSubject(DID)
      .setAudience(APP_ID)
      .setIssuer('privy.io')
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(key.privateKey)

  const GOOGLE = { type: 'google_oauth', email: 'ada@example.com', name: 'Ada Lovelace' }
  const WALLET = {
    type: 'wallet',
    address: '0xDeAdBeEf00000000000000000000000000000000',
    chain_type: 'ethereum',
    wallet_client_type: 'metamask',
    connector_type: 'injected',
    first_verified_at: '2026-09-01T10:00:00.000Z',
  }

  it('reads the name and email a social login carries', async () => {
    const read = await auth().readIdentity(await identity([GOOGLE, WALLET]))
    expect(read).toMatchObject({ did: DID, name: 'Ada Lovelace', email: 'ada@example.com' })
  })

  it('reads the linked wallets', async () => {
    const read = await auth().readIdentity(await identity([GOOGLE, WALLET]))
    expect(read.wallets).toEqual([
      {
        address: '0xdeadbeef00000000000000000000000000000000',
        walletClientType: 'metamask',
        connectorType: 'injected',
        chainType: 'ethereum',
        firstVerifiedAt: '2026-09-01T10:00:00.000Z',
        latestVerifiedAt: undefined,
      },
    ])
  })

  /**
   * Every comparison downstream is lowercase — the address column carries a
   * check constraint saying so. Normalising at the boundary means no caller
   * has to remember.
   */
  it('lowercases the address', async () => {
    const read = await auth().readIdentity(await identity([WALLET]))
    expect(read.wallets[0]?.address).toBe('0xdeadbeef00000000000000000000000000000000')
  })

  /** Older tokens date the link in epoch seconds rather than ISO. */
  it('reads a numeric verification time', async () => {
    const read = await auth().readIdentity(
      await identity([{ ...WALLET, first_verified_at: 1788000000 }]),
    )
    expect(read.wallets[0]?.firstVerifiedAt).toBe(new Date(1788000000 * 1000).toISOString())
  })

  it('accepts the camelCase spelling the SDK types use', async () => {
    const read = await auth().readIdentity(
      await identity([
        { type: 'wallet', address: '0xabc', walletClientType: 'rabby', chainType: 'ethereum' },
      ]),
    )
    expect(read.wallets[0]).toMatchObject({ walletClientType: 'rabby', chainType: 'ethereum' })
  })

  it('has no wallets when none are linked', async () => {
    const read = await auth().readIdentity(await identity([GOOGLE]))
    expect(read.wallets).toEqual([])
  })

  /**
   * A wallet's `address` field is an account, not an inbox. Treating a wallet
   * entry as a person would put "0xdead…" in the name or email column.
   */
  it('never reads a person out of a wallet entry', async () => {
    const read = await auth().readIdentity(await identity([WALLET]))
    expect(read.name).toBeUndefined()
    expect(read.email).toBeUndefined()
  })

  it('reads a bare email login', async () => {
    const read = await auth().readIdentity(await identity([{ type: 'email', address: 'a@b.co' }]))
    expect(read.email).toBe('a@b.co')
    expect(read.name).toBeUndefined()
  })

  /** Older Privy SDKs encode the claim as a JSON string. */
  it('handles linked_accounts as a JSON string', async () => {
    const read = await auth().readIdentity(await identity(JSON.stringify([GOOGLE])))
    expect(read.name).toBe('Ada Lovelace')
  })

  /** Privy does not pin the claim's shape, so the reader takes what it finds. */
  it('reads a name split across first and last', async () => {
    const read = await auth().readIdentity(
      await identity([{ type: 'google_oauth', first_name: 'Grace', last_name: 'Hopper' }]),
    )
    expect(read.name).toBe('Grace Hopper')
  })

  it('falls back to a username when there is no name at all', async () => {
    const read = await auth().readIdentity(
      await identity([{ type: 'github_oauth', username: 'gracehopper' }]),
    )
    expect(read.name).toBe('gracehopper')
  })

  it('rejects an identity token signed by someone else', async () => {
    const forged = await new jose.SignJWT({ linked_accounts: [GOOGLE] })
      .setProtectedHeader({ alg: 'ES256' })
      .setSubject(DID)
      .setAudience(APP_ID)
      .setIssuer('privy.io')
      .setExpirationTime('1h')
      .sign(otherKey.privateKey)
    await expect(auth().readIdentity(forged)).rejects.toBeInstanceOf(PrivyAuthError)
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

/**
 * The identity header takes a token the caller chose, and every Privy token
 * verifies against the same key for the same issuer and audience. So the
 * question "is this actually an identity token" has to be answered from the
 * claims, and `linked_accounts` is the only thing that answers it.
 */
describe('a token that is not an identity token', () => {
  const bare = async (claims: Record<string, unknown>) =>
    new jose.SignJWT(claims)
      .setProtectedHeader({ alg: 'ES256' })
      .setSubject(DID)
      .setAudience(APP_ID)
      .setIssuer('privy.io')
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(key.privateKey)

  /**
   * The dangerous one. An access token has no linked_accounts claim, verifies
   * perfectly, and carries the right subject. Reporting [] for it would let it
   * assert "this user has no wallets" — which the sync route acts on by
   * unlinking every proved wallet the person has.
   */
  it('reports undefined wallets for an access token, not an empty list', async () => {
    const read = await auth().readIdentity(await bare({}))
    expect(read.did).toBe(DID)
    expect(read.wallets).toBeUndefined()
    expect(read.wallets).not.toEqual([])
  })

  it.each([
    ['a claim that is not an array', { linked_accounts: { type: 'wallet' } }],
    ['a string that is not JSON', { linked_accounts: 'not json' }],
    ['JSON that is not an array', { linked_accounts: '{"type":"wallet"}' }],
    ['an explicitly null claim', { linked_accounts: null }],
    ['a numeric claim', { linked_accounts: 7 }],
  ])('reports undefined for %s', async (_label, claims) => {
    expect((await auth().readIdentity(await bare(claims))).wallets).toBeUndefined()
  })

  /** A real identity token for someone with nothing linked still says so. */
  it('still reports an empty list when the claim is present and empty', async () => {
    const read = await auth().readIdentity(await bare({ linked_accounts: [] }))
    expect(read.wallets).toEqual([])
  })

  it('accepts the stringified empty array Privy also sends', async () => {
    const read = await auth().readIdentity(await bare({ linked_accounts: '[]' }))
    expect(read.wallets).toEqual([])
  })
})
