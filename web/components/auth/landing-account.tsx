'use client'

import { usePrivy } from '@privy-io/react-auth'
import Link from 'next/link'
import { greeting } from '@/components/portfolio/greeting'
import { cn } from '@/lib/cn'
import { usePrivyAvailable } from './privy-provider'
import { useIdentity } from './session-account-menu'
import { SignInCta } from './sign-in-cta'

/**
 * The brand bar's account slot on the landing page: a greeting that opens
 * the app for someone signed in, a Sign in button for everyone else.
 *
 * Nothing is drawn until Privy has said which it is — a Sign in button that
 * turns into a greeting a beat later reads as a glitch, and the slot keeps
 * its height meanwhile so the bar does not jump.
 */
export function LandingAccount({ className }: { className?: string }) {
  return usePrivyAvailable() ? <LiveAccount className={className} /> : <SignIn className={className} />
}

function LiveAccount({ className }: { className?: string }) {
  const { ready } = usePrivy()
  const identity = useIdentity()
  if (!ready) return <span aria-hidden className={cn('h-9', className)} />
  if (!identity) return <SignIn className={className} />

  const hello = greeting(identity.label, new Date().getHours(), identity.mono ?? false)
  return (
    <Link
      href="/portfolio"
      className={cn(
        'inline-flex h-9 items-center gap-2 rounded-full border border-[rgba(255,240,220,0.22)] px-3.5',
        'text-[13px] font-semibold text-[var(--ot-cream)] transition-colors hover:bg-[rgba(255,240,220,0.1)]',
        className,
      )}
    >
      {hello}
      <span aria-hidden className="text-[var(--ot-coral)]">→</span>
      <span className="sr-only">Open Ottopus</span>
    </Link>
  )
}

function SignIn({ className }: { className?: string }) {
  return (
    <SignInCta variant="ghost" size="sm" className={cn('h-9 text-[var(--ot-cream)] hover:bg-[rgba(255,240,220,0.1)]', className)}>
      Sign in
    </SignInCta>
  )
}
