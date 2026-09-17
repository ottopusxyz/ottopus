'use client'

import { Dialog } from '@/components/ui'
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
  return (
    <Dialog open={open} onClose={onClose} title="Sign in to Ottopus" hideTitle>
      <SignInPanel headingAs="h2" />
    </Dialog>
  )
}
