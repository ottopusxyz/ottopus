import { describe, expect, it } from 'vitest'
import { balanceLine, greeting } from './greeting'

describe('the greeting', () => {
  it('says gm in the morning and hello after, with a first name', () => {
    expect(greeting('Koshik Raj', 9)).toBe('gm, Koshik')
    expect(greeting('Koshik Raj', 15)).toBe('Hello, Koshik')
    expect(greeting('Koshik Raj', 3)).toBe('Hello, Koshik')
  })

  it('greets without a name when there is none worth saying', () => {
    expect(greeting(null, 9)).toBe('gm')
    expect(greeting('  ', 15)).toBe('Hello')
    expect(greeting('0xd8da…6045', 9, true)).toBe('gm')
  })
})

describe('what the number counts', () => {
  it('counts the wallets, singular and plural', () => {
    expect(balanceLine(0)).toBe('Total balance')
    expect(balanceLine(1)).toBe('Your balance across 1 wallet')
    expect(balanceLine(4)).toBe('Your balance across 4 wallets')
  })
})
