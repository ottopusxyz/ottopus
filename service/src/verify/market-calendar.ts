/**
 * The NYSE session clock, for stock tokens whose vendor gives no session
 * word.
 *
 * The vendor's `openState` means "the underlying prints in some session
 * right now", extended hours included, and for some issuers that is all it
 * says: no session name, no next open or close. A person reading "market
 * open" at 08:00 ET would take the reference price for a regular-hours
 * print when it is a pre-market one from a thinner book. This calendar only
 * labels the session. It never decides whether the token trades, which is
 * the vendor's flag, and never reads a halt, which is the vendor's reason
 * code. Decided 2026-09-25, in the plan's ledger.
 *
 * Hours are US equities' usual ones: pre-market 04:00–09:30 ET, regular
 * 09:30–16:00 (13:00 on an early-close day), after-hours 16:00–20:00, and
 * closed the rest of the night, at weekends and on the exchange's holidays.
 * The holiday list is hand-written for the years it covers; a test fails
 * when it is about to run out, so it cannot go stale in silence.
 */

/** A session the calendar can name. `closed` is nights, weekends and holidays alike. */
export type CalendarSession = 'premarket' | 'regular' | 'afterhours' | 'closed'

export interface CalendarReading {
  session: CalendarSession
  /** The next regular-session open, as an ISO instant. Today's if it has not happened yet. */
  nextOpenAt: string
  /** The close of the regular session that `nextOpenAt` starts, or of the one running now. */
  nextCloseAt: string
}

const ZONE = 'America/New_York'

/**
 * Full-day closures, as `YYYY-MM-DD` in New York. Observed dates, so a
 * holiday on a Saturday is listed on the Friday before it and one on a
 * Sunday on the Monday after.
 */
export const NYSE_HOLIDAYS: ReadonlySet<string> = new Set([
  // 2026
  '2026-01-01', // New Year's Day
  '2026-01-19', // Martin Luther King Jr. Day
  '2026-02-16', // Presidents' Day
  '2026-04-03', // Good Friday
  '2026-05-25', // Memorial Day
  '2026-06-19', // Juneteenth
  '2026-07-03', // Independence Day, observed (4 July is a Saturday)
  '2026-09-07', // Labor Day
  '2026-11-26', // Thanksgiving
  '2026-12-25', // Christmas
  // 2027
  '2027-01-01', // New Year's Day
  '2027-01-18', // Martin Luther King Jr. Day
  '2027-02-15', // Presidents' Day
  '2027-03-26', // Good Friday
  '2027-05-31', // Memorial Day
  '2027-06-18', // Juneteenth, observed (19 June is a Saturday)
  '2027-07-05', // Independence Day, observed (4 July is a Sunday)
  '2027-09-06', // Labor Day
  '2027-11-25', // Thanksgiving
  '2027-12-24', // Christmas, observed (25 December is a Saturday)
])

/** Days the regular session ends at 13:00 ET. */
export const NYSE_EARLY_CLOSES: ReadonlySet<string> = new Set([
  '2026-11-27', // day after Thanksgiving
  '2026-12-24', // Christmas Eve
  '2027-11-26', // day after Thanksgiving
])

/** The last New York day the holiday list speaks for. After this the calendar is a guess. */
export const CALENDAR_COVERS_THROUGH = '2027-12-31'

const PREMARKET_OPEN = 4 * 60
const REGULAR_OPEN = 9 * 60 + 30
const REGULAR_CLOSE = 16 * 60
const EARLY_CLOSE = 13 * 60
const AFTERHOURS_CLOSE = 20 * 60

const parts = new Intl.DateTimeFormat('en-US', {
  timeZone: ZONE,
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  weekday: 'short',
})

interface NewYorkClock {
  /** `YYYY-MM-DD` */
  day: string
  /** Minutes since midnight. */
  minute: number
  /** 0 is Sunday, as `Date#getDay`. */
  weekday: number
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/** What a New York wall clock reads at this instant. */
export function newYorkClock(at: Date): NewYorkClock {
  const read: Record<string, string> = {}
  for (const p of parts.formatToParts(at)) read[p.type] = p.value
  return {
    day: `${read.year}-${read.month}-${read.day}`,
    minute: Number(read.hour) * 60 + Number(read.minute),
    weekday: WEEKDAYS.indexOf(read.weekday ?? ''),
  }
}

/**
 * The instant a New York wall-clock time falls on. Two passes: a UTC guess,
 * then the guess corrected by however far the zone's clock read from it,
 * which is exact except across the hour a DST change skips or repeats, and
 * no session boundary sits in that hour.
 */
export function newYorkInstant(day: string, minute: number): Date {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number]
  const guess = Date.UTC(y, m - 1, d, Math.floor(minute / 60), minute % 60)
  const offset = wallClockMs(new Date(guess)) - guess
  return new Date(guess - offset)
}

/** The zone's wall clock at `at`, read as if it were UTC, in milliseconds. */
function wallClockMs(at: Date): number {
  const read: Record<string, string> = {}
  for (const p of parts.formatToParts(at)) read[p.type] = p.value
  return Date.UTC(Number(read.year), Number(read.month) - 1, Number(read.day), Number(read.hour), Number(read.minute))
}

/** Whether the exchange holds a regular session on this New York day. */
export function isTradingDay(day: string, weekday: number): boolean {
  return weekday !== 0 && weekday !== 6 && !NYSE_HOLIDAYS.has(day)
}

function regularClose(day: string): number {
  return NYSE_EARLY_CLOSES.has(day) ? EARLY_CLOSE : REGULAR_CLOSE
}

/** The next New York calendar day, by stepping the instant a day forward at noon so DST cannot skip one. */
function nextDay(day: string): NewYorkClock {
  return newYorkClock(new Date(newYorkInstant(day, 12 * 60).getTime() + 24 * 60 * 60_000))
}

/**
 * The session running at this instant, and the regular session's next
 * bell either side of it.
 */
export function nyseSession(at: Date): CalendarReading {
  const clock = newYorkClock(at)
  const trading = isTradingDay(clock.day, clock.weekday)
  const close = regularClose(clock.day)

  let session: CalendarSession = 'closed'
  if (trading) {
    if (clock.minute >= REGULAR_OPEN && clock.minute < close) session = 'regular'
    else if (clock.minute >= PREMARKET_OPEN && clock.minute < REGULAR_OPEN) session = 'premarket'
    else if (clock.minute >= close && clock.minute < AFTERHOURS_CLOSE) session = 'afterhours'
  }

  // Today's bell if it has not rung yet, or today's close if the session is
  // running; otherwise the next day the exchange opens.
  if (trading && clock.minute < close) {
    return {
      session,
      nextOpenAt: newYorkInstant(clock.day, REGULAR_OPEN).toISOString(),
      nextCloseAt: newYorkInstant(clock.day, close).toISOString(),
    }
  }
  let next = nextDay(clock.day)
  while (!isTradingDay(next.day, next.weekday)) next = nextDay(next.day)
  return {
    session,
    nextOpenAt: newYorkInstant(next.day, REGULAR_OPEN).toISOString(),
    nextCloseAt: newYorkInstant(next.day, regularClose(next.day)).toISOString(),
  }
}
