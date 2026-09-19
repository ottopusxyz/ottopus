import { describe, expect, it } from 'vitest'
import {
  addressOf,
  formatAmount,
  formatDelta,
  formatMoney,
  formatShare,
  truncateAddress,
} from './format'

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

describe('formatMoney', () => {
  it('splits the cents out for the headline to dim', () => {
    expect(formatMoney(12431.09)).toEqual({ whole: '$12,431', fraction: '09' })
  })

  it('groups thousands and always shows two decimal places', () => {
    expect(formatMoney(1000000)).toEqual({ whole: '$1,000,000', fraction: '00' })
    expect(formatMoney(0.5)).toEqual({ whole: '$0', fraction: '50' })
  })

  it('rounds once, so the carry lands in the whole part', () => {
    // Rounding after the split prints $12,430.100 for this.
    expect(formatMoney(12430.999)).toEqual({ whole: '$12,431', fraction: '00' })
    expect(formatMoney(0.995)).toEqual({ whole: '$1', fraction: '00' })
  })

  it('uses a real minus sign, which is digit-width in a tabular column', () => {
    expect(formatMoney(-40).whole).toBe('−$40')
    expect(formatMoney(-40).whole.startsWith('-')).toBe(false)
  })

  it('does not print NaN at somebody', () => {
    expect(formatMoney(Number.NaN)).toEqual({ whole: '$0', fraction: '00' })
    expect(formatMoney(Number.POSITIVE_INFINITY)).toEqual({ whole: '$0', fraction: '00' })
  })

  it('knows the currencies the provider can price in', () => {
    expect(formatMoney(12, 'eur').whole).toBe('€12')
    expect(formatMoney(12, 'GBP').whole).toBe('£12')
  })
})

describe('formatDelta', () => {
  it('measures the percent against yesterday, not today', () => {
    // Up $100 to $1,100 is a 10% rise, not 9.09%.
    expect(formatDelta(100, 1100)?.text).toBe('+$100.00 (10.00%) today')
  })

  it('reads a fall as a fall', () => {
    const delta = formatDelta(-100, 900)
    expect(delta?.direction).toBe('down')
    expect(delta?.text).toBe('−$100.00 (10.00%) today')
  })

  it('says nothing rather than "+$0.00 (0.00%) today"', () => {
    expect(formatDelta(0, 1000)).toBeNull()
    expect(formatDelta(Number.NaN, 1000)).toBeNull()
  })

  it('drops the percent when there was nothing to grow from', () => {
    expect(formatDelta(50, 50)?.text).toBe('+$50.00 today')
  })
})

describe('formatShare', () => {
  it('shows a share to one decimal place', () => {
    expect(formatShare(0.593)).toBe('59.3%')
  })

  it('marks dust as dust rather than rounding it to 0.0%', () => {
    expect(formatShare(0.0002)).toBe('<0.1%')
  })

  it('calls a row worth nothing 0.0%, and only a non-number a dash', () => {
    expect(formatShare(0)).toBe('0.0%')
    expect(formatShare(Number.NaN)).toBe('—')
  })
})
