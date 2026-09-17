import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { ADDRESS_RE, LINK_ERRORS, MAX_ARMS, WALLET_NAMES, armName } from './naming'

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
