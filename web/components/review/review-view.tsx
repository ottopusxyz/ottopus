'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useState, type ReactNode } from 'react'
import { RequireSession, usePrivyAvailable } from '@/components/auth'
import { Otto } from '@/components/brand'
import { OttoLoader, StillnessProvider } from '@/components/motion'
import { Button, Callout, StatusChip } from '@/components/ui'
import type { Plan, PlanStatusName } from '@/lib/api'
import { canSign, countdown, effectiveStatus } from './model'
import { ReviewCard } from './review-card'
import { SignPanel } from './sign-panel'
import { useReview } from './use-review'

/**
 * P4. The link is usually opened on a phone from a chat, to decide one thing.
 * No ambient motion on this route — the water is held — and no nav: the card
 * is the page.
 *
 * Every dead link is one state. The service answers tampered, expired,
 * superseded and someone-else's with the same 404, and this page does not
 * try to tell them apart either; a hint about what a dead link used to open
 * is information the link's holder should not have.
 */
export function ReviewView({ token }: { token: string }) {
  return usePrivyAvailable() ? (
    <RequireSession>
      <Review token={token} />
    </RequireSession>
  ) : (
    <Ground>
      <Callout severity="caution" title="Sign-in is not configured">
        This deployment cannot open a review. Nothing has been signed.
      </Callout>
    </Ground>
  )
}

function Review({ token }: { token: string }) {
  const { state, move } = useReview(token)
  const now = useClock(state.status === 'ready')

  if (state.status === 'loading') {
    return (
      <Ground>
        <OttoLoader label="Otto is opening the request…" />
      </Ground>
    )
  }
  if (state.status === 'gone') {
    return (
      <Ground>
        <Gone />
      </Ground>
    )
  }
  if (state.status === 'unreachable') {
    return (
      <Ground>
        <Callout severity="caution" title="Could not reach Ottopus">
          Nothing was signed. Try again in a moment.
        </Callout>
      </Ground>
    )
  }

  const { plan } = state.read
  const status = effectiveStatus(plan, now)
  const reference = `request #${plan.id.slice(0, 6)}`

  if (status === 'blocked') {
    return (
      <Ground>
        <Blocked plan={plan} />
      </Ground>
    )
  }

  const clock = canSign(status) ? (countdown(plan.expiresAt, now) || 'now') : <StatusChip status={status} />

  return (
    <Ground>
      <ReviewCard plan={plan} reference={reference} clock={clock}>
        {canSign(status) ? (
          <SignPanel plan={plan} move={move} open />
        ) : status === 'submitted' ? (
          <SignPanel plan={plan} move={move} open={false} />
        ) : (
          <Ended status={status} />
        )}
      </ReviewCard>
    </Ground>
  )
}

/** A second hand for the countdown; stops when there is nothing to count. */
function useClock(running: boolean): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!running) return
    const id = setInterval(() => setNow(Date.now()), 1_000)
    return () => clearInterval(id)
  }, [running])
  return now
}

function Ground({ children }: { children: ReactNode }) {
  return (
    <StillnessProvider held>
      <main className="ot-canvas relative flex min-h-dvh items-start justify-center overflow-x-hidden px-0 py-0 sm:items-center sm:px-5 sm:py-11">
        <div className="relative w-full max-w-[440px]">{children}</div>
      </main>
    </StillnessProvider>
  )
}

function Gone() {
  const router = useRouter()
  return (
    <div className="flex flex-col items-center gap-3.5 px-6 py-10 text-center">
      <Otto pose="base" size={120} label="Otto" />
      <h1 className="m-0 font-[family-name:var(--ot-font-display)] text-[22px] font-bold">This link is no longer live</h1>
      <p className="m-0 max-w-[36ch] text-[14px] leading-[1.55] text-[var(--ot-text-2)]">
        It may have expired, been replaced by a newer plan, or belong to another account. Nothing was signed.
      </p>
      <Button variant="secondary" onClick={() => router.push('/requests')}>
        See what is waiting
      </Button>
    </div>
  )
}

/** S2 — execution refused. Otto is in the ink; nothing left any wallet. */
function Blocked({ plan }: { plan: Plan }) {
  const router = useRouter()
  const reasons = plan.humanPlan.warnings.filter((w) => w.severity === 'block')
  return (
    <div className="flex flex-col items-start gap-3.5 rounded-[18px] border border-[var(--ot-block-border)] bg-[var(--ot-surface)] px-5 py-6">
      <Otto pose="ink" size={140} label="Otto in the ink" />
      <h1 className="m-0 font-[family-name:var(--ot-font-display)] text-[23px] leading-[1.22] font-bold">
        Ink. Ottopus refused to prepare this.
      </h1>
      <p className="m-0 text-[14px] leading-[1.55] text-[var(--ot-text-2)]">
        {plan.humanPlan.summary}. The calls did not do what the request said, so they were never handed to a wallet.{' '}
        <strong className="text-[var(--ot-text)]">Nothing was signed and nothing left any wallet.</strong>
      </p>
      <ul className="m-0 flex w-full list-none flex-col gap-px overflow-hidden rounded-[10px] p-0">
        {reasons.map((w) => (
          <li key={w.message} className="bg-[var(--ot-block-bg)] px-[13px] py-2.5 text-[13px] text-[var(--ot-block-text)]">
            {w.message}
          </li>
        ))}
      </ul>
      <span className="text-[12.5px] text-[var(--ot-text-3)]">request #{plan.id.slice(0, 6)} is void</span>
      <Button variant="secondary" onClick={() => router.push('/settings')}>
        Review agent access
      </Button>
    </div>
  )
}

const ENDED_COPY: Partial<Record<PlanStatusName, { title: string; body: string }>> = {
  confirmed: { title: 'Signed and settled', body: 'This one is done.' },
  failed: { title: 'It did not go through', body: 'The transaction failed on chain. Nothing else was sent.' },
  expired: { title: 'This request expired', body: 'Ask the agent again and it will prepare a fresh one.' },
  cancelled: { title: 'Cancelled', body: 'Nothing was signed. The agent has been told.' },
  superseded: { title: 'Replaced by a newer plan', body: 'Open the newer link instead.' },
}

function Ended({ status }: { status: PlanStatusName }) {
  const router = useRouter()
  const copy = ENDED_COPY[status] ?? { title: 'Nothing to sign', body: 'This request is not waiting on you.' }
  return (
    <div className="flex flex-col items-center gap-2 text-center">
      {status === 'confirmed' ? <Otto pose="confirmed" size={72} label="Otto, arms up" /> : null}
      <span className="font-[family-name:var(--ot-font-display)] text-[19px] font-bold">{copy.title}</span>
      <p className="m-0 text-[12.5px] leading-[1.45] text-[var(--ot-text-2)]">{copy.body}</p>
      <Button variant="secondary" size="sm" onClick={() => router.push('/portfolio')}>
        Back to portfolio
      </Button>
    </div>
  )
}
