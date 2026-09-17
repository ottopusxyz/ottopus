import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  ADDRESS_RE,
  LINK_ERRORS,
  MAX_ARMS,
  WALLET_NAMES,
  armName,
  WALLET_AVATARS,
  walletClientName,
} from './naming'

const arm = (walletType: string, label: string | null = null) => ({ walletType, label })

describe('naming an arm', () => {
  it('prefers the label someone chose', () => {
    expect(armName(arm('safe', 'Treasury'))).toBe('Treasury')
  })

  it('falls back to the wallet client', () => {
    expect(armName(arm('metamask'))).toBe('MetaMask')
    expect(armName(arm('coinbase_wallet'))).toBe('Coinbase Wallet')
  })

  /**
   * Privy adds wallet clients without asking us. An unmapped one has to read
   * as a wallet rather than as a database value, so a new integration is
   * merely unpolished instead of broken.
   */
  it('makes an unknown client readable rather than showing the raw value', () => {
    expect(armName(arm('some_new_wallet'))).toBe('some new wallet')
  })

  it('never returns an empty name', () => {
    for (const type of [...Object.keys(WALLET_NAMES), 'anything_else']) {
      expect(armName(arm(type)).trim()).not.toBe('')
    }
  })

  /** An empty label is not a label — it must not win over the client name. */
  it('ignores an empty label', () => {
    expect(armName(arm('metamask', ''))).toBe('MetaMask')
  })
})

describe('the client chip beside the name', () => {
  it('names the client when the arm has its own label', () => {
    expect(walletClientName(arm('metamask', 'Treasury'))).toBe('MetaMask')
  })

  /** "MetaMask · MetaMask" reads as a rendering bug, not as a detail. */
  it('says nothing when it would only repeat the name', () => {
    expect(walletClientName(arm('metamask'))).toBeNull()
  })

  /**
   * Watch-only is the absence of a wallet client, not a make of one. The proof
   * mark already carries it, and a chip saying "Watch-only" beside a labelled
   * arm implies a wallet you could go and open.
   */
  it('never presents watch-only as a wallet client', () => {
    expect(walletClientName(arm('watch_only', 'Treasury'))).toBeNull()
  })

  it('says nothing for a client it does not know', () => {
    expect(walletClientName(arm('some_new_wallet', 'Treasury'))).toBeNull()
  })

  it('names a Safe, which is a real client and not just watch-only', () => {
    expect(walletClientName(arm('safe', 'Cold'))).toBe('Safe')
  })
})

describe('address validation', () => {
  it('accepts a 20-byte hex address', () => {
    expect(ADDRESS_RE.test(`0x${'a'.repeat(40)}`)).toBe(true)
  })

  it('accepts a checksummed address', () => {
    expect(ADDRESS_RE.test('0xAbC0000000000000000000000000000000000001')).toBe(true)
  })

  it.each([
    ['too short', `0x${'a'.repeat(39)}`],
    ['too long', `0x${'a'.repeat(41)}`],
    ['no prefix', 'a'.repeat(40)],
    ['not hex', `0x${'z'.repeat(40)}`],
    ['empty', ''],
    ['an ENS name', 'vitalik.eth'],
  ])('rejects %s', (_, value) => {
    expect(ADDRESS_RE.test(value)).toBe(false)
  })

  /**
   * A global regex carries lastIndex between calls, so the same input would
   * alternate true and false as someone types. Nothing catches that by eye.
   */
  it('is not global, so repeated tests agree', () => {
    const address = `0x${'a'.repeat(40)}`
    expect([ADDRESS_RE.test(address), ADDRESS_RE.test(address)]).toEqual([true, true])
  })
})

describe('error messages', () => {
  /** Every code the service can return on a link has to have words for it. */
  it.each(['already_linked', 'too_many_wallets', 'invalid_address'])('explains %s', (code) => {
    expect(LINK_ERRORS[code]).toBeTruthy()
  })

  it('never shows the raw code to a person', () => {
    for (const [code, message] of Object.entries(LINK_ERRORS)) {
      expect(message).not.toContain(code)
      expect(message).not.toContain('_')
    }
  })

  /** The cap is eight everywhere, and copy that says otherwise is a bug. */
  it('agrees with the eight-arm cap', () => {
    expect(LINK_ERRORS.too_many_wallets).toContain('eight')
  })
})

/**
 * The cap is the service's to enforce; this constant only exists so the UI can
 * say "3 of 8" and disable the button. If the two drift, the app offers room
 * that does not exist and the person gets a 422 they were told would not come.
 *
 * Read out of the source rather than imported: the web package does not depend
 * on the service, and a build-time dependency between the two deployables is a
 * much bigger thing than this test is worth.
 */
describe('the cap agrees across the two deployables', () => {
  it('matches the service', () => {
    const source = readFileSync(
      new URL('../../../service/src/wallets/reconcile.ts', import.meta.url),
      'utf8',
    )
    const declared = /export const MAX_ARMS = (\d+)/.exec(source)?.[1]
    expect(declared, 'MAX_ARMS not found in the service — did it move?').toBeDefined()
    expect(Number(declared)).toBe(MAX_ARMS)
  })
})

/**
 * Avatar contrast, computed rather than trusted.
 *
 * These are third-party brand colours, so the palette cannot be reasoned about
 * once and left alone — adding a wallet means adding a colour somebody picked
 * for a logo, not for text to sit on. Two of the current eight had to be shaded
 * darker than their published value to clear AA, and nothing about that is
 * visible by eye.
 */
describe('avatar contrast', () => {
  const channel = (v: number) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)

  function luminance(hex: string): number {
    const [r, g, b] = [1, 3, 5].map((i) => channel(parseInt(hex.slice(i, i + 2), 16) / 255))
    return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!
  }

  const ratio = (a: string, b: string) => {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
    return (hi! + 0.05) / (lo! + 0.05)
  }

  /** Sanity-check the maths against a pair everyone knows. */
  it('computes a known ratio', () => {
    expect(ratio('#FFFFFF', '#000000')).toBeCloseTo(21, 1)
  })

  it.each(Object.entries(WALLET_AVATARS))(
    '%s clears AA for a 15px bold glyph',
    (_client, { bg, fg }) => {
      expect(ratio(bg, fg)).toBeGreaterThanOrEqual(4.5)
    },
  )

  it('uses six-digit hex, which the ratio maths assumes', () => {
    for (const { bg, fg } of Object.values(WALLET_AVATARS)) {
      expect(bg).toMatch(/^#[0-9A-Fa-f]{6}$/)
      expect(fg).toMatch(/^#[0-9A-Fa-f]{6}$/)
    }
  })

  /** Every tinted avatar is a wallet the app can also name. */
  it('only tints clients it has a name for', () => {
    for (const client of Object.keys(WALLET_AVATARS)) {
      expect(WALLET_NAMES[client]).toBeTruthy()
    }
  })
})

/**
 * Privy's `walletClientType` values, pinned.
 *
 * Found the hard way: the map said `rabby` and the live data said
 * `rabby_wallet`, so a linked Rabby rendered as "rabby wallet" with no tint.
 * The failure is silent — the humanised fallback produces something that reads
 * like a styling slip rather than a missing entry — so the exact spellings are
 * asserted rather than eyeballed.
 */
describe("Privy's wallet client identifiers", () => {
  it.each([
    ['rabby_wallet', 'Rabby'],
    ['coinbase_wallet', 'Coinbase Wallet'],
    ['okx_wallet', 'OKX Wallet'],
    ['brave_wallet', 'Brave Wallet'],
    ['metamask', 'MetaMask'],
    ['phantom', 'Phantom'],
    ['safe', 'Safe'],
  ])('%s is named %s', (client, name) => {
    expect(WALLET_NAMES[client]).toBe(name)
  })

  /** The suffixed ones are the trap; the bare spellings must not creep back. */
  it.each(['rabby', 'okx', 'brave', 'bitget'])('does not use the bare spelling %s', (bare) => {
    expect(WALLET_NAMES[bare]).toBeUndefined()
    expect(WALLET_AVATARS[bare]).toBeUndefined()
  })
})
