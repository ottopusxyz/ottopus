import { describe, expect, it } from 'vitest'
import { defaultScopes, localScopes } from './scopes.js'

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
