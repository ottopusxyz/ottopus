import { describe, expect, it } from 'vitest'
import { CALENDAR_COVERS_THROUGH, NYSE_HOLIDAYS, newYorkInstant, nyseSession } from './market-calendar.js'

/**
 * The calendar is read in New York time and answers in instants, so every
 * case here is pinned to a UTC instant and says what the wall clock read.
 * September is EDT (UTC−4); December is EST (UTC−5).
 */
describe('the NYSE session calendar', () => {
  const at = (iso: string) => nyseSession(new Date(iso))

  it('names the sessions across an ordinary Friday', () => {
    // 2026-09-25 is a Friday. 08:22 ET is pre-market, the case that started this.
    expect(at('2026-09-25T12:22:00Z')).toEqual({
      session: 'premarket',
      nextOpenAt: '2026-09-25T13:30:00.000Z',
      nextCloseAt: '2026-09-25T20:00:00.000Z',
    })
    expect(at('2026-09-25T13:30:00Z').session).toBe('regular')
    expect(at('2026-09-25T19:59:00Z').session).toBe('regular')
    expect(at('2026-09-25T20:00:00Z').session).toBe('afterhours')
    expect(at('2026-09-25T23:59:00Z').session).toBe('afterhours')
    // 20:00 ET and after: closed, and the next bell is Monday's.
    expect(at('2026-09-26T00:00:00Z')).toEqual({
      session: 'closed',
      nextOpenAt: '2026-09-28T13:30:00.000Z',
      nextCloseAt: '2026-09-28T20:00:00.000Z',
    })
    // 03:59 ET is still the night; 04:00 opens pre-market.
    expect(at('2026-09-25T07:59:00Z').session).toBe('closed')
    expect(at('2026-09-25T08:00:00Z').session).toBe('premarket')
  })

  it('is closed all weekend, pointing at Monday', () => {
    // Saturday noon and Sunday noon ET.
    for (const iso of ['2026-09-26T16:00:00Z', '2026-09-27T16:00:00Z']) {
      expect(at(iso)).toEqual({
        session: 'closed',
        nextOpenAt: '2026-09-28T13:30:00.000Z',
        nextCloseAt: '2026-09-28T20:00:00.000Z',
      })
    }
  })

  it('is closed on a holiday and skips a holiday when finding the next open', () => {
    // Thanksgiving 2026, Thursday, at 11:00 ET.
    expect(at('2026-11-26T16:00:00Z').session).toBe('closed')
    // The Wednesday before it, after hours: the next session is Friday's early one, not Thursday's.
    expect(at('2026-11-26T01:00:00Z')).toEqual({
      session: 'closed',
      nextOpenAt: '2026-11-27T14:30:00.000Z',
      nextCloseAt: '2026-11-27T18:00:00.000Z',
    })
  })

  it('closes at 13:00 on an early-close day and goes straight to after-hours', () => {
    // 2026-11-27, EST: 12:59 ET is regular, 13:00 is after-hours.
    expect(at('2026-11-27T17:59:00Z')).toEqual({
      session: 'regular',
      nextOpenAt: '2026-11-27T14:30:00.000Z',
      nextCloseAt: '2026-11-27T18:00:00.000Z',
    })
    expect(at('2026-11-27T18:00:00Z').session).toBe('afterhours')
  })

  it('reads the wall clock in New York whatever the process zone', () => {
    // Regular open on a December day is 14:30Z, an hour later than in September.
    expect(newYorkInstant('2026-12-01', 9 * 60 + 30).toISOString()).toBe('2026-12-01T14:30:00.000Z')
    expect(newYorkInstant('2026-09-25', 9 * 60 + 30).toISOString()).toBe('2026-09-25T13:30:00.000Z')
  })

  it('lists observed dates, never a weekend', () => {
    for (const day of NYSE_HOLIDAYS) {
      const weekday = newYorkInstant(day, 12 * 60).getUTCDay()
      expect([0, 6], `${day} is a weekend`).not.toContain(weekday)
    }
  })

  /**
   * The list is hand-written. This fails ninety days before it runs out,
   * so the next year's dates get added while there is still time.
   */
  it('covers the next ninety days', () => {
    const horizon = new Date(Date.now() + 90 * 24 * 60 * 60_000)
    expect(horizon.toISOString().slice(0, 10) <= CALENDAR_COVERS_THROUGH, `holiday list ends ${CALENDAR_COVERS_THROUGH}`).toBe(true)
  })
})
