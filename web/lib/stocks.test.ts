import { readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { ISSUER_MARKS, ISSUER_NAMES, issuerMark, issuerName } from './stocks'

/**
 * A mark is drawn only for an issuer in ISSUER_MARKS, whatever is in the
 * folder, so the list and the folder have to agree in both directions: a
 * file nobody listed is invisible, and a listed issuer without a file is a
 * broken image beside every one of its tokens.
 */
describe('issuer marks', () => {
  const files = readdirSync(new URL('../public/stocks', import.meta.url))
    .filter((f) => f.endsWith('.svg'))
    .map((f) => f.slice(0, -4))
    .sort()

  it('lists every file in public/stocks, and nothing that is not there', () => {
    expect([...ISSUER_MARKS].sort()).toEqual(files)
  })

  it('draws a mark for a listed issuer and none for one it has not met', () => {
    expect(issuerMark('bstock')).toBe('/stocks/bstock.svg')
    expect(issuerMark('ondo')).toBe('/stocks/ondo.svg')
    expect(issuerMark('xstocks')).toBeNull()
    expect(issuerMark('someone')).toBeNull()
  })

  it('names every issuer it has a mark for', () => {
    for (const issuer of ISSUER_MARKS) expect(ISSUER_NAMES[issuer], issuer).toBeDefined()
  })

  it('writes the issuer as they do, and keeps the service word for a stranger', () => {
    expect(issuerName('bstock')).toBe('bStock')
    expect(issuerName('ondo')).toBe('Ondo')
    expect(issuerName('someone')).toBe('someone')
  })
})
