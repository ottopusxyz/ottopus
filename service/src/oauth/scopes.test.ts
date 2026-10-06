import { describe, expect, it } from 'vitest'
import { defaultScopes, localScopes, offeredScopes, withOptIns } from './scopes.js'

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

describe('offeredScopes', () => {
  it('offers wallets:write to a grant that did not ask for it', () => {
    expect(offeredScopes(defaultScopes())).toEqual(['wallets:write'])
  })

  it('offers nothing the agent already asked for', () => {
    expect(offeredScopes(['wallets:read', 'wallets:write'])).toEqual([])
  })
})

describe('withOptIns', () => {
  it('leaves the grant alone when nothing was switched on', () => {
    expect(withOptIns(defaultScopes(), [])).toEqual(defaultScopes())
  })

  it('adds an opt-in scope the person switched on', () => {
    expect(withOptIns(['wallets:read'], ['wallets:write'])).toEqual(['wallets:read', 'wallets:write'])
  })

  /** The screen can widen a grant by an opt-in scope and by nothing else. */
  it('will not add a default scope the agent left out, or anything unknown', () => {
    expect(withOptIns(['wallets:read'], ['plans:write', 'wallets:sign', 7, null])).toEqual(['wallets:read'])
  })

  it('does not repeat a scope the agent already asked for', () => {
    expect(withOptIns(['wallets:read', 'wallets:write'], ['wallets:write'])).toEqual([
      'wallets:read',
      'wallets:write',
    ])
  })
})
