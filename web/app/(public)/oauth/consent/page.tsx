import { Suspense } from 'react'
import { FullPageLoader } from '@/components/motion'
import { ConsentView } from './consent-view'

export const metadata = { title: 'Authorize an agent · Ottopus' }

/**
 * P3 in the design — the OAuth redirect target.
 *
 * A real route rather than a dialog, because an agent sent someone here from
 * outside the app. It reads like a grant: what is allowed, and the one row that
 * says what never will be.
 *
 * The Suspense boundary is what the query string needs — the request id arrives
 * in it, and useSearchParams opts the tree into client rendering.
 */
export default function ConsentPage() {
  return (
    <Suspense fallback={<FullPageLoader title="Reading the request" messages={['One moment.']} />}>
      <ConsentView />
    </Suspense>
  )
}
