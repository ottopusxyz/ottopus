'use client'

import { Dialog } from '@/components/ui'
import { EXIT_MS } from '@/components/ui/dialog'
import { SignInPanel } from './sign-in-panel'

export interface SignInDialogProps {
  open: boolean
  onClose: () => void
}

/**
 * Sign-in, in the shared shell.
 *
 * The panel draws its own centred header — badge, title, one line — so the
 * shell's title is hidden and only names the dialog for assistive technology.
 * Everything else about how a dialog behaves is the shell's, and this file is
 * now only the wiring between the two.
 */
export function SignInDialog({ open, onClose }: SignInDialogProps) {
  /**
   * Step aside before Privy's modal opens.
   *
   * Closing is not instant: `transition-behavior: allow-discrete` on `overlay`
   * deliberately keeps the dialog in the top layer for the whole exit, which is
   * what lets it animate out instead of vanishing. Privy opening during that
   * window would render behind it. So this waits for the exit it asked for.
   */
  const stepAside = () =>
    new Promise<void>((resolve) => {
      onClose()
      setTimeout(resolve, EXIT_MS)
    })

  return (
    <Dialog open={open} onClose={onClose} title="Sign in to Ottopus" hideTitle>
      <SignInPanel headingAs="h2" onLeave={stepAside} />
    </Dialog>
  )
}
