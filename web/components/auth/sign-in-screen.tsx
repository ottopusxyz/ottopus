'use client'

import { usePrivy } from '@privy-io/react-auth'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { Suspense, useEffect, type ReactNode } from 'react'
import { Lockup } from '@/components/brand'
import { BubbleField, FullPageLoader } from '@/components/motion'
import { safeNext } from '@/lib/safe-next'
import { usePrivyAvailable } from './privy-provider'
import { SignInPanel } from './sign-in-panel'

/** Where the OAuth provider sends people back to. */
const SIGN_IN_PATH = '/signin'

/**
 * How often to check we actually left, and how long to wait before forcing it.
 *
 * The wait is only paid when the navigation was undone, and it is spent behind
 * the "Signed in" loader. It is not shorter because a hard navigation does not
 * unload the document instantly — firing one before Privy's cleanup has run
 * would let that cleanup apply to a document that is still alive.
 */
const RECHECK_MS = 200
const GIVE_UP_MS = 1200

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
  // Anyone can write this parameter into a link and send it to someone.
  const next = safeNext(useSearchParams().get('next'))
  const returning = ready && authenticated

  useEffect(() => {
    if (!returning) return
    router.replace(next)

    /**
     * Coming back from a social provider, Privy strips its own query
     * parameters once the code exchange finishes:
     *
     *   searchParams.delete('privy_oauth_code') … history.replaceState({}, '', url)
     *
     * `replaceState` does not go through Next's router, so it silently undoes
     * the navigation above and pins the URL back on /signin — which is why a
     * manual refresh looked like the fix. Check once things have settled, and
     * if we are still here, leave the hard way, which nothing can replaceState
     * out from under.
     */
    // Polled rather than timed once, because the order is not guaranteed: the
    // cleanup may land before or after the navigation, and a single check at
    // the wrong moment would either miss it or fire before it happened.
    const started = Date.now()
    const settle = setInterval(() => {
      if (window.location.pathname !== SIGN_IN_PATH) {
        clearInterval(settle)
        return
      }
      if (Date.now() - started >= GIVE_UP_MS) {
        clearInterval(settle)
        // A full navigation, which nothing can replaceState out from under.
        window.location.replace(next)
      }
    }, RECHECK_MS)

    return () => clearInterval(settle)
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
