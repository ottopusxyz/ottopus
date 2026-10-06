import { describe, expect, it } from 'vitest'
import { chosenScopes, isOn, move, type Moves } from './choices'

const offer = (scope: string, requested: boolean) => ({ scope, title: scope, detail: '', requested })

const ASKED = offer('wallets:write', true)
const NOT_ASKED = offer('wallets:write', false)
const UNTOUCHED: Moves = {}

describe('optional consent switches', () => {
  it('start on when the agent asked and off when it did not', () => {
    expect(isOn(ASKED, UNTOUCHED)).toBe(true)
    expect(isOn(NOT_ASKED, UNTOUCHED)).toBe(false)
  })

  it('stay where the person left them', () => {
    expect(isOn(ASKED, move(UNTOUCHED, ASKED.scope, false))).toBe(false)
    expect(isOn(NOT_ASKED, move(UNTOUCHED, NOT_ASKED.scope, true))).toBe(true)
  })

  /**
   * The page reads the request again whenever its credentials change. An
   * unticked switch the agent asked for came back ticked after that second
   * read, because the read set the switches. Now the read only replaces the
   * request, so the same moves against a fresh copy must give the same answer.
   */
  it('keep an unticked switch off when the request is read again', () => {
    const moves = move(UNTOUCHED, ASKED.scope, false)
    const readAgain = [offer('wallets:write', true)]
    expect(chosenScopes(readAgain, moves)).toEqual([])
  })

  it('send back only the offered scopes that are on', () => {
    const offered = [ASKED, offer('other:thing', false)]
    expect(chosenScopes(offered, UNTOUCHED)).toEqual(['wallets:write'])
    expect(chosenScopes(offered, move(UNTOUCHED, 'other:thing', true))).toEqual([
      'wallets:write',
      'other:thing',
    ])
    expect(chosenScopes(offered, move(UNTOUCHED, 'never:offered', true))).toEqual(['wallets:write'])
  })
})
