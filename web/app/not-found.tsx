import Link from 'next/link'
import { Otto } from '@/components/brand'
import { EmptyState, buttonClasses } from '@/components/ui'

/**
 * An address that leads nowhere in Ottopus.
 *
 * An empty state, not an error: nothing was attempted, so there is no damage
 * to bound — only a space to name and a way out of it. A review link that
 * has died is a different case with its own words on the review page; this
 * is a typo, a stale bookmark, a path that was never here.
 */
export default function NotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[var(--ot-bg)] p-6">
      <EmptyState
        title="Nothing here"
        description="This address doesn’t lead anywhere in Ottopus."
        illustration={<Otto pose="base" size={150} />}
        action={
          <Link href="/portfolio" className={buttonClasses({ variant: 'secondary' })}>
            Back to your wallets
          </Link>
        }
      />
    </main>
  )
}
