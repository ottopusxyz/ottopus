'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useState, type ReactNode } from 'react'
import { RequireSession, usePrivyAvailable } from '@/components/auth'
import { Otto } from '@/components/brand'
import { StillnessProvider } from '@/components/motion'
import { Button, Callout, StatusChip } from '@/components/ui'
import type { Plan, PlanStatusName } from '@/lib/api'
import { cn } from '@/lib/cn'
import { decoderUrl } from '@/lib/simulators'
import { AdvancedPanel } from './advanced-panel'
import { canSign, chainOfPlan, countdown, effectiveStatus } from './model'
import { ReviewCard } from './review-card'
import { AdvancedSkeleton, ReviewSkeleton } from './review-skeleton'
import { SignPanel } from './sign-panel'
import { useReview } from './use-review'
import { useSimulation } from './use-simulation'

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
  const read = state.status === 'ready' ? state.read : null
  const plan = read?.plan ?? null
  const chainId = plan ? chainOfPlan(plan) : null
  // The chain's own currency, as the service names it. The page must not work
  // this out: the SLIP-44 table lives in core, and a guess would label BNB as
  // ETH on the row the browser's own simulation produces.
  const native = chainId ? (read?.visuals?.chains[chainId] ?? null) : null
  const simulation = useSimulation(plan, chainId, native)

  if (state.status === 'loading') {
    // `wide` so the loader stands exactly where the card will: a skeleton that
    // matches the card's shape but not its position still hands the reader a
    // jump the moment the plan lands.
    return (
      <Ground wide>
        <div className="relative mx-auto w-full max-w-[440px]">
          <ReviewSkeleton />
          <aside className="absolute top-0 left-full ml-4 hidden w-[280px] min-[1032px]:block">
            <AdvancedSkeleton />
          </aside>
        </div>
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

  const { visuals, statusDetail } = state.read
  if (!plan) return null
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
  const live = { kind: simulation.state.kind, run: simulation.run, again: () => void simulation.again() }
  const panelProps = { plan, live, decoderUrl: decoderUrl(plan) }

  /**
   * The card stays centred in the viewport and the panel hangs off its right
   * edge, rather than the pair being centred together.
   *
   * The card is the page. Centring the two as a block would slide the thing
   * everybody reads off to the left to make room for the thing most people
   * never open, and the page would appear to move sideways the moment the
   * panel had something to say. Absolute placement keeps the card exactly
   * where it is at every width.
   *
   * The breakpoint is the arithmetic, not a guess: 440 for the card plus 16
   * of gap plus 280 of panel, doubled around the centre, is 1032.
   */
  return (
    <Ground wide>
      <div className="relative mx-auto w-full max-w-[440px]">
        <div className="w-full min-w-0">
          <ReviewCard
            plan={plan}
            reference={reference}
            clock={clock}
            visuals={visuals}
            live={live}
            advanced={
              <details className="ot-review-details border-t border-[var(--ot-border)]">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-[18px] py-3 text-[13px] font-semibold [&::-webkit-details-marker]:hidden">
                  Advanced review
                  <span className="ot-review-caret text-[var(--ot-text-3)]" aria-hidden>
                    ▾
                  </span>
                </summary>
                <div className="px-[18px]">
                  <AdvancedPanel {...panelProps} bare />
                </div>
              </details>
            }
          >
            {canSign(status) ? (
              <SignPanel plan={plan} move={move} open recheck={simulation.recheck} />
            ) : status === 'submitted' ? (
              <SignPanel plan={plan} move={move} open={false} txHash={statusDetail?.txHash ?? null} />
            ) : (
              <Ended status={status} />
            )}
          </ReviewCard>
        </div>
        <aside className="absolute top-0 left-full ml-4 hidden w-[280px] min-[1032px]:block">
          <AdvancedPanel {...panelProps} />
        </aside>
      </div>
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

function Ground({ children, wide = false }: { children: ReactNode; wide?: boolean }) {
  return (
    <StillnessProvider held>
      <main
        className={cn(
          'ot-canvas relative flex min-h-dvh justify-center overflow-x-hidden px-0 py-0 sm:px-5 sm:py-11',
          // A plan sits at the top on a wide screen because the panel beside
          // it is taller than the card; a dead link is short and centres.
          wide ? 'items-start' : 'items-start sm:items-center',
        )}
      >
        <div className={cn('relative w-full', wide ? 'max-w-[440px] lg:max-w-[824px]' : 'max-w-[440px]')}>{children}</div>
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
