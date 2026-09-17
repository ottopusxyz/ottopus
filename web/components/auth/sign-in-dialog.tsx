'use client'

import { useEffect, useId, useRef } from 'react'
import { SignInPanel } from './sign-in-panel'

export interface SignInDialogProps {
  open: boolean
  onClose: () => void
}

/**
 * The sign-in dialog.
 *
 * A native `<dialog>` opened with `showModal()`, which is where the focus trap,
 * Escape, the inert background and the backdrop come from — the browser's, not
 * ours. #33 replaces this with the shared shell that all nine dialogs use, and
 * it should be a small change: everything specific to signing in lives in
 * SignInPanel, and this file is the shell it sits in.
 *
 * Body scroll is the one thing `showModal()` does not handle.
 */
export function SignInDialog({ open, onClose }: SignInDialogProps) {
  const ref = useRef<HTMLDialogElement>(null)
  const headingId = useId()

  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (open && !el.open) el.showModal()
    if (!open && el.open) el.close()
  }, [open])

  useEffect(() => {
    if (!open) return
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previous
    }
  }, [open])

  return (
    <dialog
      ref={ref}
      aria-labelledby={headingId}
      onClose={onClose}
      // Clicking the backdrop lands on the dialog itself, never on its contents.
      onClick={(e) => {
        if (e.target === ref.current) onClose()
      }}
      className={
        'w-[min(420px,calc(100vw-2rem))] rounded-[var(--ot-radius-lg)] border ' +
        'border-[var(--ot-border)] bg-[var(--ot-card)] p-6 text-[var(--ot-text)] ' +
        'shadow-[var(--ot-shadow-card)] backdrop:bg-[rgba(22,33,62,0.45)] ' +
        'backdrop:backdrop-blur-[2px]'
      }
    >
      <SignInPanel headingId={headingId} headingAs="h2" />
    </dialog>
  )
}
