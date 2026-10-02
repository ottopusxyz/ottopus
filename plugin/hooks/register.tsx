import type { Register, Timer } from 'claude-code'

import type { CapturedPlan } from '../types'
import { cardOf, clockTime, timeLeft } from './card'
import { capturePlan, followPlan, prepareCall, statusCall } from './plan'
import type { Trust } from './plan'

const PLAN = { plugin: 'ottopus', key: 'plan' } as const
const DISMISSED = { plugin: 'ottopus', key: 'dismissed' } as const

const DEFAULT_REVIEW_ORIGIN = 'https://ottopus.xyz'

const text = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null)

type Clock = { clock: { now(): Promise<number>; every(ms: number, fn: () => void): Timer }; ui: { invalidate(event: 'ui.render'): void } }

let ticking: Timer | null = null

function stop(): void {
  ticking?.cancel()
  ticking = null
}

/**
 * The countdown. The band is drawn again only when something it reads
 * changes, and time is not one of those things: while a quote is still
 * running this asks for a redraw each second, and once more as it runs out
 * so the card stops offering a signature.
 */
async function countDown($: Clock, plan: CapturedPlan | null): Promise<void> {
  stop()
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
}

export const register: Register = (on, options) => {
  const trust: Trust = {
    reviewOrigin: text(options.reviewOrigin) ?? DEFAULT_REVIEW_ORIGIN,
    server: text(options.server),
  }

  /** A reload drops the timer but not the plan: pick the countdown back up. */
  on('session.start', async ($, e, next) => {
    try {
      const { value: plan = null } = await $.state.get(PLAN)
      const { value: dismissed = null } = await $.state.get(DISMISSED)
      if (plan && plan.planId !== dismissed) await countDown($, plan)
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
        await $.state.set(PLAN, captured)
        await countDown($, captured)
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
    const { value: dismissed = null } = await $.state.get(DISMISSED)
    const card = plan && plan.planId !== dismissed ? cardOf(plan, await $.clock.now()) : null
    if (!plan || !card) return next(e)

    const { Box, Button, Link, Text } = $.ui.resolve(e)
    const until = card.expiresAt ? clockTime(card.expiresAt) : null
    const left = card.expiresAt ? timeLeft(card.expiresAt, await $.clock.now()) : null
    const { link } = card

    return (
      <Box key="ottopus-card" flexDirection="column">
        <Text>
          <Text bold>
            Ottopus · {card.title}
          </Text>
          {until ? <Text dimColor> · quote holds until {until}</Text> : null}
          {left ? <Text dimColor> · {left} left</Text> : null}
        </Text>
        <Text>{card.summary}</Text>
        {card.lines.map((line) => (
          <Text dimColor={card.tone !== 'blocked'}>{line}</Text>
        ))}
        {card.warnings.map((warning) => (
          <Text>Heads up: {warning}</Text>
        ))}
        <Box gap={2}>
          {link ? <Link href={link.href}>{link.label}</Link> : null}
          {link ? (
            <Button
              key="copy"
              label="Copy link"
              onPress={async (press) => {
                const copied = await $.ui.copy({ text: link.href, surface: press.surface })
                $.ui.toast(copied.isCopied ? 'Review link copied' : link.href)
              }}
            />
          ) : null}
          <Button key="dismiss" label="Dismiss" role="dismiss" onPress={() => (stop(), $.state.set(DISMISSED, plan.planId))} />
        </Box>
      </Box>
    )
  })
}
