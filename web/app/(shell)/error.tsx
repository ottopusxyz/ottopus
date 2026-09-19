'use client'

import { Otto } from '@/components/brand'
import { PageColumn } from '@/components/shell'
import { Button, ErrorState, NOTHING_SIGNED } from '@/components/ui'

/**
 * What a shell page becomes when rendering it throws.
 *
 * Without this file the answer was Next's stock "Application error" screen,
 * which says nothing about what did not happen — on a product where that is
 * the only sentence worth reading. The layout above this boundary survives,
 * so the nav is still there and the person can walk to another page rather
 * than reload into the broken one.
 *
 * `digest` is Next's hash of a server-side error, shown small: it is what a
 * report can be matched to a log line by, and it carries no detail of its
 * own.
 */
export default function ShellError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <PageColumn>
      <div className="px-5 py-10 sm:px-[26px]">
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
    </PageColumn>
  )
}
