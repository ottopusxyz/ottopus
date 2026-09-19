import type { PlanSummary } from '@/lib/api'

export interface RequestsState {
  plans: PlanSummary[]
  loaded: boolean
  failed: boolean
}

/** The service owns pending statuses. Locally we only age out its pending response. */
export function liveRequests(plans: readonly PlanSummary[], now = Date.now()): PlanSummary[] {
  return plans.filter((plan) => Date.parse(plan.expiresAt) > now)
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
}

/** One read at a time; a stopped session can never publish its response into the next. */
export function pollRequests(read: () => Promise<{ plans: PlanSummary[] }>, publish: (state: RequestsState) => void) {
  let stopped = false
  let busy = false
  let state: RequestsState = { plans: [], loaded: false, failed: false }
  const emit = () => {
    state = { ...state, plans: liveRequests(state.plans) }
    if (!stopped) publish(state)
  }
  const refresh = async () => {
    if (stopped || busy) return
    busy = true
    try {
      const response = await read()
      if (!stopped) state = { plans: response.plans, loaded: true, failed: false }
    } catch {
      if (!stopped) state = { ...state, failed: true }
    } finally {
      busy = false
      emit()
    }
  }
  void refresh()
  const poll = setInterval(() => { void refresh() }, 5_000)
  const expiry = setInterval(() => {
    if (state.plans.some(plan => Date.parse(plan.expiresAt) <= Date.now())) emit()
  }, 1_000)
  return { refresh, stop: () => { stopped = true; clearInterval(poll); clearInterval(expiry) } }
}
