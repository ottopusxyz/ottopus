import { describe, expect, it } from 'vitest'
import { defaultScopes, localScopes, optInScopes, withOptIns } from './scopes.js'

describe('localScopes', () => {
  it('is the defaults when the launcher named nothing, so never wallets:write', () => {
    expect(localScopes(undefined)).toEqual(defaultScopes())
    expect(localScopes('')).not.toContain('wallets:write')
  })

  it('adds an opt-in scope only when it is named', () => {
    expect(localScopes('wallets:write')).toEqual([...defaultScopes(), 'wallets:write'])
  })

  it('drops what it does not recognise and does not repeat a default', () => {
    expect(localScopes('plans:read wallets:sign')).toEqual(defaultScopes())
  })
})

describe('optInScopes', () => {
  it('is wallets:write and nothing a client gets by default', () => {
    expect(optInScopes()).toEqual(['wallets:write'])
    expect(defaultScopes()).not.toContain('wallets:write')
  })
})

describe('withOptIns', () => {
  it('leaves the grant alone when nothing was switched on', () => {
    expect(withOptIns(defaultScopes(), [])).toEqual(defaultScopes())
  })

  it('adds an opt-in scope the person switched on', () => {
    expect(withOptIns(['wallets:read'], ['wallets:write'])).toEqual(['wallets:read', 'wallets:write'])
  })

  /** The screen decides the opt-in scopes and nothing else. */
  it('will not add a default scope the agent left out, or anything unknown', () => {
    expect(withOptIns(['wallets:read'], ['plans:write', 'wallets:sign', 7, null])).toEqual(['wallets:read'])
  })

  it('keeps an opt-in scope the agent asked for when its switch stayed on', () => {
    expect(withOptIns(['wallets:read', 'wallets:write'], ['wallets:write'])).toEqual([
      'wallets:read',
      'wallets:write',
    ])
  })

  /** Asking by name sets where the switch starts. It does not grant. */
  it('drops an opt-in scope the agent asked for when its switch is off', () => {
    expect(withOptIns(['wallets:write', 'wallets:read'], [])).toEqual(['wallets:read'])
  })
})
