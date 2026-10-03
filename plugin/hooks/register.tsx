import type { EngineInterface, Register, Timer } from 'claude-code'

import type { CapturedPlan } from '../types'
import {
  BURST_FRAME_MS,
  BURST_MS,
  burstCells,
  cardOf,
  clockTime,
  isSettled,
  isUrgent,
  lifeLeft,
  meter,
  METER_CELLS,
  meterCells,
  PAINT,
  shareLeft,
  SPIN_MS,
  spinFrame,
  timeLeft,
} from './card'
import { isMoving, OTTO_COLUMNS, OTTO_MS, OTTO_ROWS, ottoCells, poseOf } from './otto'
import { capturePlan, followPlan, planView, prepareCall, statusCall } from './plan'
import type { Trust } from './plan'

const PLAN = { plugin: 'ottopus', key: 'plan' } as const

const DEFAULT_REVIEW_ORIGIN = 'https://ottopus.xyz'

const text = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null)

type Clock = {
  clock: { now(): Promise<number>; every(ms: number, fn: () => void): Timer }
  ui: { invalidate(event: 'ui.render'): void; blit(args: { requestId: string; key: string; cells: string }): Promise<unknown> }
}

const METER = 'ottopus-meter'
const OTTO = 'ottopus-otto'
/** The painted bar moves an eighth of a cell at a time; it is never repainted faster than this. */
const STEPS = METER_CELLS * 8
const MIN_PAINT_MS = 100
/**
 * The fill behind the review link for each border colour, which makes it read
 * as a button. The label is navy: white fails on both fills, navy clears AA.
 */
const FILL: Record<string, string> = {
  blue: '#5B9BFF',
  yellow: '#F5A524',
}
const NAVY = '#16213E'

let ticking: Timer | null = null
let painting: Timer | null = null
let waving: Timer | null = null
let spinning = false
/** The band's own id once a terminal has drawn it: where the painted bar is repainted. */
let band: string | null = null
/** The plan and status last counted, so a plan turning confirmed is told from one found confirmed. */
let seen: { planId: string; status: string } | null = null
let burst: { since: number } | null = null

function stop(): void {
  ticking?.cancel()
  ticking = null
  painting?.cancel()
  painting = null
  waving?.cancel()
  waving = null
  spinning = false
  burst = null
}

/** Repaints the bar in place, between redraws. A band not drawn, or drawn elsewhere, has nothing to repaint. */
function repaint($: Clock, cells: string | null, key: string = METER): void {
  if (band === null || cells === null) return
  void $.ui.blit({ requestId: band, key, cells }).catch(() => {})
}

/**
 * Otto blinks beside a plan that is waiting on a signature, painted only
 * when the frame is new. Started by the terminal that drew
 * him, so nothing turns where he is not shown.
 */
function wave($: Clock): void {
  if (waving) return
  let last: string | null = null
  waving = $.clock.every(OTTO_MS, () => {
    void $.clock.now().then(
      (now) => {
        const cells = ottoCells('idle', now)
        if (cells !== last) repaint($, cells, OTTO)
        last = cells
      },
      () => {},
    )
  })
}

/** The sweep across the bar as a plan confirms: a moment, then the card is still again. */
async function celebrate($: Clock): Promise<void> {
  const since = await $.clock.now()
  burst = { since }
  $.ui.invalidate('ui.render')
  const frame = $.clock.every(BURST_FRAME_MS, () => {
    void $.clock.now().then(
      (now) => {
        if (painting !== frame) return
        if (now - since < BURST_MS) return repaint($, burstCells(now - since))
        stop()
        $.ui.invalidate('ui.render')
      },
      () => {},
    )
  })
  painting = frame
}

/**
 * The countdown. The band is drawn again only when something it reads
 * changes, and time is not one of those things: while a quote is still
 * running this asks for a redraw each second, and once more as it runs out
 * so the card stops offering a signature. A submitted plan has no quote to
 * count; it turns the loader instead, until the plan settles or the watch
 * on it ends. Between the seconds the painted bar drains on a faster timer
 * of its own, and a plan seen turning confirmed gets its sweep. Otto, beside
 * the card, blinks for as long as the plan waits on a signature.
 */
async function countDown($: Clock, plan: CapturedPlan | null): Promise<void> {
  const was = seen
  seen = plan ? { planId: plan.planId, status: plan.status } : null
  // A sweep cut short leaves its bar drawn; take it down.
  if (burst) $.ui.invalidate('ui.render')
  stop()
  if (plan?.status === 'confirmed') {
    if (band !== null && was?.planId === plan.planId && was.status !== 'confirmed') await celebrate($)
    return
  }
  if (plan?.status === 'submitted') {
    ticking = $.clock.every(SPIN_MS, () => $.ui.invalidate('ui.render'))
    spinning = true
    return
  }
  const expiresAt = cardOf(plan, await $.clock.now())?.expiresAt
  const due = expiresAt ? Date.parse(expiresAt) : Number.NaN
  if (Number.isNaN(due)) return
  const tick = $.clock.every(1000, () => {
    $.ui.invalidate('ui.render')
    void $.clock.now().then(
      (now) => {
        if (now >= due && ticking === tick) stop()
      },
      () => {},
    )
  })
  ticking = tick
  const { capturedAt } = plan ?? {}
  if (!expiresAt || capturedAt === undefined) return
  // A long quote moves the bar less than once a second: the redraw above paints every step of it.
  const step = (due - capturedAt) / STEPS
  if (!(step < 1000)) return
  painting = $.clock.every(Math.max(MIN_PAINT_MS, Math.floor(step)), () => {
    void $.clock.now().then(
      (now) => {
        const life = lifeLeft(capturedAt, expiresAt, now)
        if (life !== null) repaint($, meterCells(life, due - now))
      },
      () => {},
    )
  })
}

const POLL_MS = 5_000
const MAX_POLL_MS = 60_000
const MAX_MISSES = 5
const WATCH_MS = 30 * 60_000

let watch: { timer: Timer | null } | null = null

function unwatch(): void {
  watch?.timer?.cancel()
  watch = null
}

/**
 * The watcher. The person signs in a browser, where no tool call passes
 * through here, so the plugin asks get_plan itself over the connection that
 * prepared the plan and under the same grant. It asks while the plan can
 * still move, once more as the quote runs out in case a signature landed at
 * the last second, and gives up after a few failed calls in a row. An answer
 * goes through followPlan like any other: status and expiry, never the link.
 */
async function follow($: EngineInterface, plan: CapturedPlan): Promise<void> {
  unwatch()
  if (isSettled(plan.status)) return
  const mine: { timer: Timer | null } = { timer: null }
  watch = mine
  const since = await $.clock.now()
  let delay = POLL_MS
  let misses = 0
  const poll = async (): Promise<void> => {
    if (watch !== mine) return
    let isLast = false
    try {
      const { value: current = null } = await $.state.get(PLAN)
      if (!current || current.planId !== plan.planId || isSettled(current.status)) {
        isLast = true
      } else {
        const now = await $.clock.now()
        const isOver = now - since > WATCH_MS
        isLast = cardOf(current, now)?.tone !== 'ready' || isOver
        const answer = await $.mcp.call(current.server, 'get_plan', { planId: current.planId })
        if (answer.isError) throw new Error('get_plan failed')
        const followed = followPlan(current, current.server, planView(answer))
        const { value: latest = null } = await $.state.get(PLAN)
        if (followed && watch === mine && latest?.planId === followed.planId) {
          await $.state.set(PLAN, followed)
          await countDown($, followed)
          // The answer decides, not the card it replaced: a signature in the quote's last second is still followed.
          isLast = isSettled(followed.status) || cardOf(followed, now)?.tone !== 'ready' || isOver
        }
        delay = POLL_MS
        misses = 0
      }
    } catch {
      // The card keeps the last status it knew.
      misses += 1
      delay = Math.min(delay * 2, MAX_POLL_MS)
      isLast ||= misses >= MAX_MISSES
    }
    if (watch !== mine) return
    if (isLast) {
      unwatch()
      // Nobody is asking any more: a loader left turning would say otherwise.
      if (spinning) {
        stop()
        $.ui.invalidate('ui.render')
      }
    } else mine.timer = $.clock.after(delay, () => void poll())
  }
  mine.timer = $.clock.after(delay, () => void poll())
}

export const register: Register = (on, options) => {
  const trust: Trust = {
    reviewOrigin: text(options.reviewOrigin) ?? DEFAULT_REVIEW_ORIGIN,
    server: text(options.server),
  }

  /** A reload drops the timers but not the plan: pick the countdown and the watch back up. */
  on('session.start', async ($, e, next) => {
    try {
      const { value: plan = null } = await $.state.get(PLAN)
      if (plan) {
        await countDown($, plan)
        await follow($, plan)
      }
    } catch {
      // No countdown; the card still draws.
    }
    return next(e)
  })

  /**
   * Watches prepare_* results go by and remembers the newest plan. The call
   * and its result pass through untouched: a failure in here must never cost
   * the agent the answer it was given.
   */
  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    if (ran.deny !== undefined) return ran
    const call = prepareCall(e.tool, trust)
    const asked = call ? null : statusCall(e.tool)
    if (asked) {
      // The agent checked on a plan, or withdrew it. If it is the one on the
      // card, the card follows; a result about any other plan changes nothing.
      try {
        const { value: plan = null } = await $.state.get(PLAN)
        const followed = plan ? (followPlan(plan, asked, ran.result) ?? followPlan(plan, asked, ran.text)) : null
        if (followed) {
          await $.state.set(PLAN, followed)
          await countDown($, followed)
          if (isSettled(followed.status)) unwatch()
        }
      } catch {
        // The plain output already reached the agent.
      }
      return ran
    }
    if (!call) return ran
    try {
      const captured = capturePlan(call, ran.result, trust) ?? capturePlan(call, ran.text, trust)
      // A newer plan replaces the one before it, whatever that one was. A
      // prepare that produced no plan leaves the earlier one: it still stands.
      if (captured) {
        // Without a clock the plan is still kept; only the share left goes unshown.
        const capturedAt = await $.clock.now().catch(() => undefined)
        const seen = capturedAt === undefined ? captured : { ...captured, capturedAt }
        await $.state.set(PLAN, seen)
        await countDown($, seen)
        await follow($, seen)
      }
    } catch {
      // The plain output already reached the agent.
    }
    return ran
  })

  /**
   * The card: the newest plan in a band above the prompt. It says what the
   * agent already said and offers one way forward, the review page. Nothing
   * here approves, signs or sends.
   */
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const { value: plan = null } = await $.state.get(PLAN)
    const card = plan ? cardOf(plan, await $.clock.now()) : null
    if (!plan || !card) return next(e)

    const { Box, Link, Text } = $.ui.resolve(e)
    // The cell grid is the terminal's alone; elsewhere the bar is text.
    const Raster = e.surface === 'terminal' ? $.ui.resolve(e).Raster : null
    if (Raster) band = e.requestId
    const now = await $.clock.now()
    const until = card.expiresAt ? clockTime(card.expiresAt) : null
    const left = card.expiresAt ? timeLeft(card.expiresAt, now) : null
    const share = card.expiresAt ? shareLeft(plan.capturedAt, card.expiresAt, now) : null
    const isLate = card.expiresAt !== null && isUrgent(card.expiresAt, now)
    const { link } = card
    const paint = PAINT[card.kind]
    const hue = paint.color ? { color: paint.color } : { dimColor: true }
    const edge = isLate ? 'yellow' : paint.color
    const bar = share !== null ? meter(share) : null
    const life = card.expiresAt ? lifeLeft(plan.capturedAt, card.expiresAt, now) : null
    const cells = card.expiresAt && life !== null ? meterCells(life, Date.parse(card.expiresAt) - now) : null
    const sweep = card.kind === 'confirmed' && burst ? burstCells(now - burst.since) : null
    // A link, so the terminal or the app opens it and nothing here runs; a
    // live plan's is drawn on a solid fill, to read as a button, and so is a
    // confirmed plan's way to the explorer, in the chain's own colour.
    const fill = link?.paint?.fill ?? (edge ? FILL[edge] : undefined)
    const ink = link?.paint?.ink ?? NAVY
    const glyph = card.kind === 'submitted' && spinning ? spinFrame(now) : paint.glyph
    // Otto holds still once nothing is counting: a loader left turning would say otherwise.
    const pose = poseOf(card.kind)
    const otto = isMoving(pose) && !ticking ? ottoCells(pose, 0) : ottoCells(pose, now)
    if (Raster && pose === 'idle' && ticking) wave($)

    return (
      <Box key="ottopus-card" gap={2} borderStyle="round" paddingX={1} {...(edge ? { borderColor: edge } : { borderDimColor: true })}>
        {Raster ? <Raster key={OTTO} columns={OTTO_COLUMNS} rows={OTTO_ROWS} cells={otto} /> : null}
        <Box flexDirection="column">
          <Box gap={1}>
            <Text bold {...hue}>
              {glyph}
            </Text>
            <Text>
              <Text bold {...hue}>
                Ottopus · {card.title}
              </Text>
              {card.kind === 'submitted' ? <Text dimColor> · awaiting confirmation</Text> : null}
            </Text>
          </Box>
          {until || left ? (
            <Box key="ottopus-clock" gap={1}>
              <Text>
                {until ? <Text dimColor>quote holds until {until}</Text> : null}
                {left && isLate ? (
                  <Text bold color="yellow">
                    {until ? ' · ' : ''}
                    {left} left · sign soon
                  </Text>
                ) : null}
                {left && !isLate ? (
                  <Text dimColor>
                    {until ? ' · ' : ''}
                    {left} left
                  </Text>
                ) : null}
              </Text>
              {Raster && cells ? <Raster key={METER} columns={METER_CELLS} rows={1} cells={cells} /> : null}
              {bar && !(Raster && cells) ? (
                <Box key={METER}>
                  <Text {...(edge ? { color: edge } : {})}>{bar.full}</Text>
                  <Text dimColor>{bar.rest}</Text>
                </Box>
              ) : null}
            </Box>
          ) : null}
          {Raster && sweep ? <Raster key={METER} columns={METER_CELLS} rows={1} cells={sweep} /> : null}
          <Text bold>{card.summary}</Text>
          {card.lines.map((line) => (card.kind === 'refused' ? <Text color="red">{line}</Text> : <Text dimColor>{line}</Text>))}
          {card.warnings.map((warning) => (
            <Text color="magenta">⚠ {warning}</Text>
          ))}
          {link ? (
            <Box>
              {fill ? (
                <Link key="review" href={link.href}>
                  <Text bold color={ink} backgroundColor={fill}>
                    {`  ${link.label}  `}
                  </Text>
                </Link>
              ) : (
                <Link key="review" href={link.href} label={link.label} />
              )}
            </Box>
          ) : null}
        </Box>
      </Box>
    )
  })
}
