'use client'

import { usePrivy } from '@privy-io/react-auth'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { Suspense, useEffect, type ReactNode } from 'react'
import { Lockup } from '@/components/brand'
import { BubbleField, FullPageLoader } from '@/components/motion'
import { usePrivyAvailable } from './privy-provider'
import { SignInPanel } from './sign-in-panel'

/**
 * /signin, for someone who is already signed in.
 *
 * Coming back from Google the session is good and the only thing left is the
 * redirect. Showing the form for that beat invites someone to start signing in
 * again on a page that is about to disappear, so the page becomes the loader
 * instead. Rendered only where Privy mounted, so the hook always has context.
 */
function Live() {
  const { ready, authenticated } = usePrivy()
  const router = useRouter()
  const next = useSearchParams().get('next') ?? '/portfolio'
  const returning = ready && authenticated

  useEffect(() => {
    if (returning) router.replace(next)
  }, [returning, router, next])

  if (returning) {
    return <FullPageLoader title="Signed in" messages={['Taking you to your portfolio']} />
  }
  return <Canvas />
}

/**
 * The page itself. Water is allowed here: the design lists auth alongside
 * marketing as page canvas, and nothing on it carries an amount, an address or
 * an approval.
 */
function Canvas({ children }: { children?: ReactNode }) {
  return (
    <div className="ot-canvas relative flex min-h-dvh flex-col overflow-hidden">
      <BubbleField pattern="canvas" />

      <header className="relative px-5 py-4 sm:px-8">
        <Link href="/" aria-label="Ottopus home">
          <Lockup layout="horizontal" size={30} />
        </Link>
      </header>

      <main className="relative flex flex-1 items-center justify-center px-5 py-10">
        {children}
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

function Screen() {
  // Splitting here rather than lifting state out of Live: a redirect component
  // that unmounts and remounts as the page swaps would fire its effect twice.
  return usePrivyAvailable() ? <Live /> : <Canvas />
}

export function SignInScreen() {
  // useSearchParams opts the route out of static prerendering without one.
  return (
    <Suspense fallback={null}>
      <Screen />
    </Suspense>
  )
}
