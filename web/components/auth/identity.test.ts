import { describe, expect, it } from 'vitest'
import { identityFrom } from './identity'

const WALLET = '0xd8da6bf26964af9d7eed9e03e53415d37aa96045'

/**
 * The sidebar trigger, the menu header and the Settings card all name the same
 * person from this. One function, so they cannot disagree.
 */
describe('naming the signed-in person', () => {
  it('leads with the stored name and puts the email under it', () => {
    expect(identityFrom({ name: 'Koshik Raj', email: 'k@example.com' }, null)).toEqual({
      label: 'Koshik Raj',
      detail: 'k@example.com',
    })
  })

  it('does not repeat an email that is also the name', () => {
    expect(identityFrom({ name: 'k@example.com', email: 'k@example.com' }, null)).toEqual({
      label: 'k@example.com',
    })
  })

  it('shows a lone email once, with nothing under it', () => {
    expect(identityFrom({ name: null, email: 'k@example.com' }, null)).toEqual({
      label: 'k@example.com',
    })
  })

  it('falls back to what Privy has before the session is established', () => {
    expect(identityFrom(null, { id: 'did:privy:1', email: { address: 'k@example.com' } })).toEqual({
      label: 'k@example.com',
    })
    expect(identityFrom(null, { id: 'did:privy:1', google: { email: 'g@example.com' } })).toEqual({
      label: 'g@example.com',
    })
  })

  it('prefers the stored name even when Privy has an email', () => {
    expect(
      identityFrom({ name: 'Koshik Raj', email: null }, { id: 'x', email: { address: 'k@example.com' } }),
    ).toEqual({ label: 'Koshik Raj', detail: 'k@example.com' })
  })

  it('shows a wallet-only account as its truncated address, in mono', () => {
    const identity = identityFrom(null, { id: 'did:privy:1', wallet: { address: WALLET } })
    expect(identity?.mono).toBe(true)
    expect(identity?.label).toMatch(/^0xd8da…6045$/i)
    expect(identity?.label).not.toBe(WALLET)
  })

  it('shows a DID only when there is nothing else, in mono', () => {
    expect(identityFrom(null, { id: 'did:privy:1' })).toEqual({ label: 'did:privy:1', mono: true })
  })

  it('names nobody when there is nobody', () => {
    expect(identityFrom(null, null)).toBeUndefined()
    expect(identityFrom({ name: null, email: null }, null)).toBeUndefined()
  })
})
