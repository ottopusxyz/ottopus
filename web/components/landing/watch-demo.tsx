'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Dialog, buttonClasses } from '@/components/ui'
import { cn } from '@/lib/cn'

/** The demo on YouTube. The README links the same video. */
export const DEMO_VIDEO_ID = 'Vd0IQDSakgc'
export const DEMO_VIDEO_URL = `https://youtu.be/${DEMO_VIDEO_ID}`

/** The header link's look, matching "How it works" beside it: hidden on a phone. */
const NAV_LINK =
  'hidden h-9 items-center rounded-full px-3 text-[13px] font-medium text-[var(--ot-cream)] ' +
  'transition-colors hover:bg-[rgba(255,240,220,0.1)] sm:inline-flex'

/** The inline look: plain words with a dotted underline that firms up on hover. */
const INLINE_LINK =
  'cursor-pointer underline decoration-dotted decoration-1 underline-offset-4 ' +
  'transition-colors hover:text-[var(--ot-text)] hover:decoration-solid'

/**
 * "Watch the demo", from the landing page: the video plays in a dialog over
 * the page rather than sending the visitor off to YouTube. `hero` is the
 * button beside the calls to action; `nav` is the short link in the brand bar;
 * `inline` turns its children, such as the hero's "Built at" line, into a link.
 *
 * The player is youtube-nocookie and only mounts while the dialog is open, so
 * a visitor who never clicks loads nothing from YouTube and gets no cookie.
 * Closing unmounts it, which is also what stops the sound.
 */
export function WatchDemo({
  variant = 'hero',
  className,
  children,
}: {
  variant?: 'hero' | 'nav' | 'inline'
  className?: string
  children?: ReactNode
}) {
  const [open, setOpen] = useState(false)
  const close = useRef<HTMLButtonElement>(null)

  // Focus starts on Close, not in the player: showModal() would pick the
  // iframe, and an Escape inside another origin's frame never reaches the
  // dialog. autoFocus can't do it, because the button mounts while the dialog
  // is still shut. This runs after Dialog's own effect has called showModal().
  useEffect(() => {
    if (open) close.current?.focus()
  }, [open])

  return (
    <>
      <button
        type="button"
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
        className={cn(
          variant === 'nav' ? NAV_LINK : variant === 'inline' ? INLINE_LINK : buttonClasses({ variant: 'ghost', size: 'lg' }),
          className,
        )}
      >
        {variant === 'nav' ? (
          'Demo'
        ) : variant === 'inline' ? (
          <>
            {children}
            <span className="sr-only"> (watch the demo)</span>
          </>
        ) : (
          <>
            <svg aria-hidden viewBox="0 0 16 16" className="h-4 w-4" fill="currentColor">
              <path d="M4.5 2.8v10.4a.6.6 0 0 0 .9.5l8.2-5.2a.6.6 0 0 0 0-1L5.4 2.3a.6.6 0 0 0-.9.5Z" />
            </svg>
            Watch the demo
          </>
        )}
      </button>

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="The Ottopus demo"
        className="sm:[&_.ot-dialog-panel]:w-[min(880px,calc(100vw-2rem))]"
        actions={
          <button
            ref={close}
            type="button"
            onClick={() => setOpen(false)}
            className={buttonClasses({ variant: 'secondary', fullWidth: true })}
          >
            Close
          </button>
        }
      >
        <div className="aspect-video w-full overflow-hidden rounded-[var(--ot-radius-md)] bg-[var(--ot-navy)]">
          {open ? (
            <iframe
              src={`https://www.youtube-nocookie.com/embed/${DEMO_VIDEO_ID}?autoplay=1&rel=0`}
              title="Ottopus demo"
              allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
              allowFullScreen
              className="h-full w-full border-0"
            />
          ) : null}
        </div>
      </Dialog>
    </>
  )
}
