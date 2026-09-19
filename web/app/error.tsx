'use client'

import { Otto } from '@/components/brand'
import { Button, ErrorState, NOTHING_SIGNED } from '@/components/ui'

/**
 * The boundary for the public routes — sign-in, consent, a review link —
 * which have no shell around them. Same report as the shell's, without the
 * nav that is not there to keep.
 *
 * The review page has its own words for a link that has died; this catches
 * the page itself failing to draw, which is a different thing and must not
 * be read as the plan being gone.
 */
export default function PublicError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[var(--ot-bg)] p-6">
      <div>
        <ErrorState
          title="This page broke"
          description={`Something went wrong drawing it, not doing anything. ${NOTHING_SIGNED}`}
          illustration={<Otto pose="ink" size={150} />}
          action={
            <Button variant="secondary" onClick={reset}>
              Try again
            </Button>
          }
        />
        {error.digest ? (
          <p className="mt-3 text-center font-mono text-[11px] text-[var(--ot-text-3)]">{error.digest}</p>
        ) : null}
      </div>
    </main>
  )
}
