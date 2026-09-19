'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { Otto } from '@/components/brand'
import { BubbleField } from '@/components/motion'
import { Button, EmptyState, ErrorState, NOTHING_SIGNED } from '@/components/ui'
import { ApiError } from '@/lib/api'
import { PlanTable, PlanTableSkeleton } from './plan-table'
import { useRequests } from './provider'
import { usePlans } from './use-plans'

/**
 * P5, on the Requests route: every request, waiting-on-you first. The badge
 * in the nav counts the pending subset through RequestsProvider; this page
 * reads the whole history and re-reads whenever that count moves.
 */
export function RequestsView() {
  const { plans: pending, open } = useRequests()
  const { state, refresh } = usePlans(pending.map((p) => `${p.id}:${p.version}:${p.status}`).join(','))
  const router = useRouter()
  const [opening, setOpening] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  // A slow clock, so a row reads expired within the minute without a reload.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(id)
  }, [])

  const review = async (id: string) => {
    if (opening) return
    setOpening(id)
    setError(null)
    try {
      router.push(await open(id))
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 404
          ? 'That request is no longer here. The list is being refreshed.'
          : 'Couldn’t open this request. Please try again.',
      )
      refresh()
    } finally {
      setOpening(null)
    }
  }

  if (state.status === 'loading') {
    return (
      <div className="px-5 py-6 sm:px-[26px]">
        <PlanTableSkeleton />
      </div>
    )
  }
  if (state.status === 'failed' && state.plans.length === 0) {
    return (
      <ErrorState
        title="Couldn’t read your requests"
        description={`Try again to see what is waiting on you. ${NOTHING_SIGNED}`}
        action={
          <Button variant="secondary" onClick={refresh}>
            Try again
          </Button>
        }
      />
    )
  }

  return (
    <div className="px-5 py-6 sm:px-[26px]">
      {state.status === 'failed' ? (
        <p role="status" className="mb-4 text-sm text-[var(--ot-text-2)]">
          Couldn’t refresh. Showing the last requests we read.{' '}
          <button className="underline" onClick={refresh}>
            Try again
          </button>
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="mb-4 text-sm text-[var(--ot-block-text)]">
          {error}
        </p>
      ) : null}
      {state.plans.length === 0 ? (
        <div className="ot-canvas relative overflow-hidden rounded-2xl">
          <BubbleField pattern="calm" />
          <EmptyState
            className="relative"
            title="Calm waters"
            description="Nothing yet. Otto surfaces here when your agent asks for something."
            illustration={<Otto pose="base" size={150} animated />}
          />
        </div>
      ) : (
        <PlanTable plans={state.plans} opening={opening} onOpen={(id) => void review(id)} now={now} />
      )}
    </div>
  )
}
