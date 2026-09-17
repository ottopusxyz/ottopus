'use client'

import { usePrivy } from '@privy-io/react-auth'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { Button, type ButtonProps } from '@/components/ui'
import { SignInDialog } from './sign-in-dialog'
import { usePrivyAvailable } from './privy-provider'

export interface SignInCtaProps {
  children: React.ReactNode
  variant?: ButtonProps['variant']
  size?: ButtonProps['size']
  className?: string
  /** Where to land once signed in. */
  next?: string
}

/**
 * A button that opens the sign-in dialog, and gets out of the way once you are
 * signed in — the landing page's call to action should say "Open Ottopus" to
 * someone who already has a session, not ask them to sign in again.
 */
export function SignInCta(props: SignInCtaProps) {
  return usePrivyAvailable() ? <LiveCta {...props} /> : <OfflineCta {...props} />
}

/** Privy never mounted. The button still opens the dialog, which explains why. */
function OfflineCta({ children, variant = 'primary', size = 'lg', className }: SignInCtaProps) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button variant={variant} size={size} className={className} onClick={() => setOpen(true)}>
        {children}
      </Button>
      <SignInDialog open={open} onClose={() => setOpen(false)} />
    </>
  )
}

function LiveCta({
  children,
  variant = 'primary',
  size = 'lg',
  className,
  next = '/portfolio',
}: SignInCtaProps) {
  const { ready, authenticated } = usePrivy()
  const [open, setOpen] = useState(false)
  const router = useRouter()

  // The dialog is where the flow ends, so the person is moved on rather than
  // left looking at a login form they have already completed. Whether it is
  // showing is derived from authentication rather than closed by hand — an
  // effect that also sets state would race the navigation.
  useEffect(() => {
    if (open && authenticated) router.push(next)
  }, [open, authenticated, router, next])

  const signedIn = ready && authenticated

  return (
    <>
      <Button
        variant={variant}
        size={size}
        className={className}
        onClick={() => (signedIn ? router.push(next) : setOpen(true))}
      >
        {signedIn ? 'Open Ottopus' : children}
      </Button>
      <SignInDialog open={open && !authenticated} onClose={() => setOpen(false)} />
    </>
  )
}
