'use client'

import { usePrivy } from '@privy-io/react-auth'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, type ReactNode } from 'react'
import { OttoLoader } from '@/components/motion'
import { usePrivyAvailable } from './privy-provider'

/**
 * Keeps signed-out visitors out of the app shell.
 *
 * Client-side, because that is where the session is — Privy holds the token in
 * the browser and there is no cookie for the server to read. This is a
 * redirect, not a security boundary: everything that matters is enforced by the
 * service, which verifies the token on every request and never trusts the fact
 * that a page rendered.
 *
 * Renders a loader rather than the page while Privy is deciding. Showing the
 * portfolio and then yanking it away is worse than a moment of nothing, and the
 * page behind would briefly display someone else's shape of data.
 *
 * Does nothing when Privy is not configured, so a checkout without env still
 * shows the app instead of bouncing forever between two routes.
 */
export function RequireSession({ children }: { children: ReactNode }) {
  return usePrivyAvailable() ? <Guarded>{children}</Guarded> : <>{children}</>
}

function Guarded({ children }: { children: ReactNode }) {
  const { ready, authenticated } = usePrivy()
  const router = useRouter()
  const pathname = usePathname()

  const blocked = ready && !authenticated

  useEffect(() => {
    if (blocked) router.replace(`/signin?next=${encodeURIComponent(pathname)}`)
  }, [blocked, router, pathname])

  if (!ready || blocked) {
    return (
      <div className="flex min-h-dvh items-center justify-center p-10">
        <OttoLoader label={blocked ? 'Taking you to sign in…' : 'Finding your session…'} />
      </div>
    )
  }

  return <>{children}</>
}
