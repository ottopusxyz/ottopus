import { describe, expect, it } from 'vitest'
import { addressOf, formatAmount, truncateAddress } from './format'

describe('formatAmount', () => {
  it('converts base units without floating point', () => {
    // 1234.5678 USDC at 6 decimals.
    expect(formatAmount('1234567800', 6)).toBe('1,234.5678')
  })

  it('handles a full ether, which exceeds MAX_SAFE_INTEGER in base units', () => {
    expect(formatAmount('1000000000000000000', 18)).toBe('1')
    expect(formatAmount('1500000000000000000', 18)).toBe('1.5')
  })

  it('keeps precision on a value a float would round', () => {
    // Number('9007199254740993') is 9007199254740992 — the odd unit is lost.
    expect(formatAmount('9007199254740993', 0, { grouping: false })).toBe('9007199254740993')
  })

  it('trims trailing zeros but keeps significant ones', () => {
    expect(formatAmount('1500000', 6)).toBe('1.5')
    expect(formatAmount('1050000', 6)).toBe('1.05')
  })

  it('truncates rather than rounds up', () => {
    // Rounding up would show more than the person actually receives.
    expect(formatAmount('1999999999', 6, { maxFractionDigits: 2 })).toBe('1,999.99')
  })

  it('never renders a non-zero amount as zero', () => {
    // "0" on a review page reads as nothing moving.
    expect(formatAmount('1', 18)).toBe('<0.000000000000000001')
    expect(formatAmount('1', 6, { maxFractionDigits: 2 })).toBe('<0.000001')
  })

  it('renders an actual zero as zero', () => {
    expect(formatAmount('0', 18)).toBe('0')
  })

  it('handles zero decimals', () => {
    expect(formatAmount('42', 0)).toBe('42')
  })

  it('rejects input that is not an integer string', () => {
    expect(() => formatAmount('1.5', 18)).toThrow(/not an integer/)
    expect(() => formatAmount('-1', 18)).toThrow(/not an integer/)
    expect(() => formatAmount('1', -1)).toThrow(/decimals/)
  })
})

describe('truncateAddress', () => {
  const addr = '0xd8da6bf26964af9d7eed9e03e53415d37aa96045'

  it('middle-truncates', () => {
    expect(truncateAddress(addr)).toBe('0xd8da…6045')
  })

  it('leaves short strings alone rather than mangling them', () => {
    expect(truncateAddress('0xabc')).toBe('0xabc')
  })

  it('preserves casing, since display may be checksummed', () => {
    expect(truncateAddress('0xD8dA6BF26964aF9D7eEd9e03E53415D37aA96045')).toBe('0xD8dA…6045')
  })
})

describe('addressOf', () => {
  it('pulls the address out of a CAIP-10 identifier', () => {
    expect(addressOf('eip155:8453:0xd8da6bf26964af9d7eed9e03e53415d37aa96045')).toBe(
      '0xd8da6bf26964af9d7eed9e03e53415d37aa96045',
    )
  })

  it('passes a bare address through', () => {
    expect(addressOf('0xabc')).toBe('0xabc')
  })
})
