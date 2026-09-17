'use client'

import { usePrivy } from '@privy-io/react-auth'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { Suspense, useEffect } from 'react'
import { Lockup } from '@/components/brand'
import { BubbleField } from '@/components/motion'
import { usePrivyAvailable } from './privy-provider'
import { SignInPanel } from './sign-in-panel'

/**
 * Sends an already-signed-in visitor where they were going. Rendered only where
 * Privy mounted, so the hook it calls always has its context.
 *
 * Nothing of its own on screen — the redirect is the whole component.
 */
function RedirectWhenSignedIn() {
  const { ready, authenticated } = usePrivy()
  const router = useRouter()
  const next = useSearchParams().get('next') ?? '/portfolio'

  useEffect(() => {
    if (ready && authenticated) router.replace(next)
  }, [ready, authenticated, router, next])

  return null
}

/**
 * /signin as a page. The same panel as the dialog, so the two cannot drift.
 *
 * Water is allowed here: the design lists auth alongside marketing as page
 * canvas, and this page carries no amount, address or approval.
 */
function Screen() {
  const available = usePrivyAvailable()

  return (
    <div className="ot-canvas relative flex min-h-dvh flex-col overflow-hidden">
      <BubbleField pattern="canvas" />

      <header className="relative px-5 py-4 sm:px-8">
        <Link href="/" aria-label="Ottopus home">
          <Lockup layout="horizontal" size={30} />
        </Link>
      </header>

      <main className="relative flex flex-1 items-center justify-center px-5 py-10">
        {available ? <RedirectWhenSignedIn /> : null}
        <div
          className={
            'w-full max-w-[420px] rounded-[var(--ot-radius-lg)] border ' +
            'border-[var(--ot-border)] bg-[var(--ot-card)] p-6 ' +
            'shadow-[var(--ot-shadow-card)]'
          }
        >
          <SignInPanel headingAs="h1" />
        </div>
      </main>
    </div>
  )
}

export function SignInScreen() {
  // useSearchParams opts the route out of static prerendering without one.
  return (
    <Suspense fallback={null}>
      <Screen />
    </Suspense>
  )
}
