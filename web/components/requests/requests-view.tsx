'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { Otto } from '@/components/brand'
import { BubbleField } from '@/components/motion'
import { Button, EmptyState, ErrorState } from '@/components/ui'
import { ApiError } from '@/lib/api'
import { useRequests } from './provider'

export function RequestsView() {
  const { plans, loaded, failed, refresh, open } = useRequests()
  const router = useRouter()
  const [opening, setOpening] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const review = async (id: string) => {
    if (opening) return
    setOpening(id)
    setError(null)
    try {
      router.push(await open(id))
    } catch (err) {
      setError(err instanceof ApiError && (err.status === 404 || err.status === 409)
        ? 'This request is no longer waiting. The list is being refreshed.'
        : 'Couldn’t open this request. Please try again.')
    } finally {
      setOpening(null)
    }
  }
  if (!loaded && !failed) return <p role="status" className="px-6 py-10 text-sm text-[var(--ot-text-2)]">Reading requests…</p>
  if (failed && !plans.length) return <ErrorState title="Couldn’t read your requests" description="Try again to see what is waiting on you." action={<Button variant="secondary" onClick={refresh}>Try again</Button>} />
  return (
    <div className="px-5 py-6 sm:px-[26px]">
      {failed ? <p role="status" className="mb-4 text-sm text-[var(--ot-text-2)]">Couldn’t refresh. Showing the last requests we read. <button className="underline" onClick={refresh}>Try again</button></p> : null}
      {error ? <p role="alert" className="mb-4 text-sm text-[var(--ot-block-text)]">{error}</p> : null}
      {plans.length === 0 ? (
        <div className="ot-canvas relative overflow-hidden rounded-2xl">
          <BubbleField pattern="calm" />
          <EmptyState className="relative" title="Calm waters" description="Nothing is waiting. Otto surfaces here when your agent asks for something." illustration={<Otto pose="base" size={150} animated />} />
        </div>
      ) : (
        <ul aria-label="Pending requests" className="space-y-3">
          {plans.map((plan) => (
            <li key={`${plan.id}:${plan.version}`}>
              <button onClick={() => { void review(plan.id) }} disabled={opening !== null}
                className="w-full rounded-2xl border border-[var(--ot-border)] bg-[var(--ot-card)] p-4 text-left transition-colors hover:bg-[var(--ot-surface-2)] focus-visible:outline-2 focus-visible:outline-[var(--ot-plan)] disabled:opacity-60 sm:p-5">
                <span className="flex items-start justify-between gap-3">
                  <span className="text-[15px] font-semibold">{plan.summary}</span>
                  <span className="shrink-0 text-xs text-[var(--ot-plan-text)]">{opening === plan.id ? 'Opening…' : 'Review →'}</span>
                </span>
                <span className="mt-2 block text-sm text-[var(--ot-text-2)]">{plan.reason}</span>
                <span className="mt-3 block text-xs text-[var(--ot-text-3)]">{plan.createdVia === 'agent' ? 'From your agent' : 'Created in Ottopus'} · Expires <time dateTime={plan.expiresAt}>{new Date(plan.expiresAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time></span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
