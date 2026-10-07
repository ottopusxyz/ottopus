'use client'

import { useCallback, useMemo, useState } from 'react'
import { Otto } from '@/components/brand'
import { LoaderDots, TentacleRing } from '@/components/motion'
import { Button, Dialog } from '@/components/ui'
import { ApiError, type Plan, type WebTransition } from '@/lib/api'
import { addressOf, truncateAddress } from '@/lib/format'
import { type PlanStep, planSteps } from './model'

/**
 * The bottom of the card for a plan bound to a wallet an agent operates.
 *
 * There is nothing to connect: the person reads, then approves or rejects,
 * and the agent's own wallet sends. Approving writes `approved` through the
 * plan store, which releases the calls to the agent through `get_plan`;
 * rejecting inks the plan as cancel does for a signed one. No wallet gate and
 * no chain switch, because no key is in this browser.
 *
 * Once approved the panel is the wait. Until the agent has read the calls
 * the approval can still be withdrawn; after that the plan ends as the chain
 * decides, and the page says so rather than offering a cancel the service
 * would refuse.
 */
export interface ApprovePanelProps {
  plan: Plan
  move: (transition: WebTransition) => Promise<unknown>
  /** Whose wallet sends: the vendor's name, for the copy. */
  executor: string
  /** Set once the plan is approved: the wait, who approved it, and whether the agent already holds the calls. */
  waiting?: { approvedBy: 'you' | 'rule'; handedOff: boolean } | undefined
  /**
   * Re-run the calls immediately before the approval is written: the plan was
   * built minutes ago and the agent will send exactly these calls, so an
   * approval of a batch the chain already refuses is one the person should
   * not be able to give.
   */
  recheck?: (() => Promise<{ success: boolean; revertReason?: string; failedCall?: number } | null>) | undefined
}

type Phase = 'idle' | 'checking' | 'approving' | 'withdrawing'

export function ApprovePanel({ plan, move, executor, waiting, recheck }: ApprovePanelProps) {
  const [phase, setPhase] = useState<Phase>('idle')
  const [problem, setProblem] = useState<string | null>(null)
  const [confirmReject, setConfirmReject] = useState(false)
  const [rejecting, setRejecting] = useState(false)
  const steps = useMemo(() => planSteps(plan), [plan])
  const arm = plan.resolution.account.label ?? truncateAddress(addressOf(plan.resolution.account.caip10))

  const approve = useCallback(async () => {
    setProblem(null)
    setPhase('checking')
    try {
      // The last look before the calls leave. A run that cannot answer says
      // nothing and stops nobody; one that reverts does, because the agent
      // would send it regardless and burn a fee for nothing.
      if (recheck) {
        const fresh = await recheck()
        if (fresh && !fresh.success) {
          setPhase('idle')
          const which = fresh.failedCall ? `Call ${fresh.failedCall}` : 'This batch'
          setProblem(
            `${which} now reverts against the chain${fresh.revertReason ? `: ${fresh.revertReason}` : ''}. ` +
              'Nothing was approved. Ask the agent to prepare it again.',
          )
          return
        }
      }
      setPhase('approving')
      // The service approves from `awaiting_review` alone. A plan a page once
      // took toward a signature steps back first, which the machine allows
      // for a wallet that disconnected, rather than being refused here.
      if (plan.status === 'awaiting_signature') await move({ status: 'awaiting_review' })
      await move({ status: 'approved' })
      // The parent re-reads the status and swaps this panel into the wait.
    } catch (err) {
      setPhase('idle')
      setProblem(describeRefusal(err, 'It could not be approved.'))
    }
  }, [move, recheck, plan.status])

  const reject = useCallback(async () => {
    setRejecting(true)
    try {
      await move({ status: 'cancelled' })
    } catch (err) {
      setProblem(describeRefusal(err, 'It could not be rejected.'))
    } finally {
      // Closed either way: a refusal reads on the panel, not behind a dialog.
      setRejecting(false)
      setConfirmReject(false)
    }
  }, [move])

  /** Take an approval back, while the agent has not yet read the calls. */
  const withdraw = useCallback(async () => {
    setProblem(null)
    setPhase('withdrawing')
    try {
      await move({ status: 'cancelled' })
    } catch (err) {
      // A 409 is the plan having moved on since the last poll — the agent
      // read the calls, chat cancelled it, or it expired — and the re-read
      // behind it says which. Nothing here claims to know before that.
      setProblem(describeRefusal(err, 'It could not be withdrawn.'))
    } finally {
      setPhase('idle')
    }
  }, [move])

  if (waiting) {
    return (
      <div className="flex flex-col gap-2 rounded-[10px] bg-[var(--ot-card)] px-3 py-[11px]">
        {/* Otto taps the cube: the wait is on the agent, and he is watching for it. */}
        <div className="flex items-center gap-3">
          <Otto pose="tapping" size={56} animated label="Otto, waiting for the agent" className="-my-2 flex-none" />
          <div className="flex flex-col gap-0.5">
            <LoaderDots
              label={waiting.handedOff ? 'Your agent is executing' : 'Waiting for your agent'}
              className="font-semibold text-[var(--ot-text)]"
            />
            <p className="m-0 text-[12.5px] leading-[1.45] text-[var(--ot-text-2)]">
              {waiting.approvedBy === 'rule' ? `Approved by your rule for ${arm}.` : 'You approved this.'}{' '}
              {waiting.handedOff
                ? `Your agent has the calls and sends them from ${executor}; Ottopus does not.`
                : `Your agent picks it up next and sends it from ${executor}; Ottopus does not.`}
            </p>
          </div>
        </div>
        {problem ? (
          <p role="alert" className="m-0 text-[12px] text-[var(--ot-warn-text)]">
            {problem}
          </p>
        ) : null}
        {!waiting.handedOff ? (
          <Button variant="link" size="sm" className="self-start" disabled={phase === 'withdrawing'} onClick={() => void withdraw()}>
            {phase === 'withdrawing' ? 'Withdrawing…' : 'Withdraw approval'}
          </Button>
        ) : null}
      </div>
    )
  }

  const busy = phase !== 'idle'

  return (
    <div className="flex flex-col gap-3">
      <AgentStepList steps={steps} executor={executor} />

      <p className="m-0 text-[12.5px] leading-[1.5] text-[var(--ot-text-2)]">
        Approving lets your {executor} execute this through your agent. Ottopus does not send it.
      </p>

      {problem ? (
        <p role="alert" className="m-0 rounded-[8px] bg-[var(--ot-warn-bg)] px-3 py-2 text-[12.5px] text-[var(--ot-warn-text)]">
          {problem}
        </p>
      ) : null}

      <div className="flex gap-2">
        <Button variant="secondary" size="lg" fullWidth disabled={busy} onClick={() => setConfirmReject(true)}>
          Reject
        </Button>
        <Button variant="primary" size="lg" fullWidth disabled={busy} onClick={() => void approve()}>
          {busy ? (
            <span className="inline-flex items-center gap-2">
              <TentacleRing size={18} tone="current" />
              {phase === 'checking' ? 'Checking' : 'Approving'}
            </span>
          ) : (
            'Approve'
          )}
        </Button>
      </div>

      <Dialog
        open={confirmReject}
        onClose={() => (rejecting ? undefined : setConfirmReject(false))}
        title="Reject this request?"
        tone="destructive"
        description="The agent will be told it was rejected. Nothing has been sent, and nothing will be."
        actions={
          <>
            <Button variant="secondary" disabled={rejecting} onClick={() => setConfirmReject(false)}>
              Keep it
            </Button>
            <Button variant="destructive" disabled={rejecting} onClick={reject}>
              {rejecting ? 'Rejecting…' : 'Reject request'}
            </Button>
          </>
        }
      />
    </div>
  )
}

/**
 * Every call the agent's wallet will send, in order. No batching claim and
 * no signature count: that is between the agent and its vendor, and the
 * honest thing to say here is what leaves and from where.
 */
function AgentStepList({ steps, executor }: { steps: readonly PlanStep[]; executor: string }) {
  if (steps.length === 0) return null
  const heading = steps.length === 1 ? `One call from your ${executor}` : `${steps.length} calls from your ${executor}`
  return (
    <div className="flex flex-col gap-2 rounded-[10px] bg-[var(--ot-card)] px-3 py-[11px]">
      <span className="text-[11.5px] text-[var(--ot-text-3)]">{heading}</span>
      <ol className="m-0 flex list-none flex-col gap-1.5 p-0">
        {steps.map((step) => (
          <li key={step.index} className="flex items-center gap-2">
            <span
              aria-hidden
              className="flex h-[19px] w-[19px] flex-none items-center justify-center rounded-full bg-[var(--ot-surface-3)] text-[10.5px] font-semibold text-[var(--ot-text-3)]"
            >
              {step.index}
            </span>
            <span className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-1.5">
              <span className="text-[13px] text-[var(--ot-text-2)]">{step.label}</span>
              {step.detail ? <span className="text-[11px] text-[var(--ot-text-3)]">{step.detail}</span> : null}
            </span>
          </li>
        ))}
      </ol>
    </div>
  )
}

/**
 * A refusal in words. The service's 409 means the plan is not where this
 * page thinks it is — expired on the service's clock, cancelled from chat —
 * and the page re-reads on the back of it; anything else is a failed
 * request, worth one more try. Never the raw code or the request line.
 */
function describeRefusal(err: unknown, fallback: string): string {
  if (err instanceof ApiError && err.status === 409) return `${fallback} The request has moved on; this page is catching up.`
  return `${fallback} Try again in a moment.`
}
