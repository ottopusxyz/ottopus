import type { Register } from 'claude-code'

import { capturePlan, prepareCall } from './plan'

const PLAN = { plugin: 'ottopus', key: 'plan' } as const

export const register: Register = (on) => {
  /**
   * Watches prepare_* results go by and remembers the newest plan. The call
   * and its result pass through untouched: a failure in here must never cost
   * the agent the answer it was given.
   */
  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    const call = prepareCall(e.tool)
    if (!call || ran.deny !== undefined) return ran
    try {
      const captured = capturePlan(call, ran.result) ?? capturePlan(call, ran.text)
      // A newer plan replaces the one before it, whatever that one was.
      if (captured) await $.state.set(PLAN, captured)
    } catch {
      // The plain output already reached the agent.
    }
    return ran
  })
}
