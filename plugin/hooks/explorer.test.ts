import { expect, test } from 'claude-code/testing'

import { EXPLORER_CHAINS, explorerOf, txHashOf } from './explorer'

const HASH = `0x${'ab'.repeat(32)}`

/** WCAG relative luminance of `#RRGGBB`. */
function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = Number.parseInt(hex.slice(i, i + 2), 16) / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi! + 0.05) / (lo! + 0.05)
}

test('a transaction on a known chain leads to that chain explorer, in its colour', () => {
  expect(explorerOf('eip155:56', HASH)).toEqual({ href: `https://bscscan.com/tx/${HASH}`, fill: '#F0B90B', ink: '#16213E' })
  expect(explorerOf('eip155:8453', HASH)).toEqual({ href: `https://basescan.org/tx/${HASH}`, fill: '#0052FF', ink: '#FFFFFF' })
})

test('no explorer for a chain not in the table, or for a hash that is not one', () => {
  expect(explorerOf('eip155:999999', HASH)).toBe(null)
  expect(explorerOf(null, HASH)).toBe(null)
  expect(explorerOf('eip155:56', null)).toBe(null)
  expect(explorerOf('eip155:56', '0xabc')).toBe(null)
  expect(explorerOf('eip155:56', `${HASH}/../../address/0x1`)).toBe(null)
  expect(txHashOf('https://evil.example')).toBe(null)
  expect(txHashOf(HASH)).toBe(HASH)
})

test('every chain button label clears AA on its fill', () => {
  for (const chain of EXPLORER_CHAINS) {
    const { fill, ink } = explorerOf(chain, HASH)!
    expect(contrast(fill, ink)).toBeGreaterThanOrEqual(4.5)
  }
})
