'use client'

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react'
import { cn } from '@/lib/cn'

/** Past this, a release dismisses instead of snapping back. */
const DISMISS_AFTER_PX = 90

/**
 * How long the exit takes, matching --ot-dur-base in dialog.css.
 *
 * A caller that has to wait for the dialog to leave the top layer needs this
 * number, and the alternative to exporting it is each caller guessing.
 */
export const EXIT_MS = 260

export type DialogTone = 'default' | 'destructive'

export interface DialogProps {
  open: boolean
  onClose: () => void
  /**
   * Names the dialog. Always present for assistive technology; set
   * `hideTitle` when the content draws its own header, as the sign-in
   * dialog does.
   */
  title: string
  hideTitle?: boolean
  description?: ReactNode
  /**
   * Destructive confirms name what breaks. The tone only shades the frame —
   * the words are the caller's job, and the design is explicit that a
   * destructive dialog must say what stops working.
   */
  tone?: DialogTone
  /**
   * Buttons. Stacked full width below 640px with the primary last, because on
   * a phone the last item is the one under the thumb.
   */
  actions?: ReactNode
  children?: ReactNode
  className?: string
}

/**
 * The shell behind every dialog in the product.
 *
 * A native `<dialog>` opened with `showModal()`. The focus trap, Escape, the
 * inert background and the top layer are the browser's — a hand-rolled version
 * of any of those is a bug waiting on the one surface where a mistake costs
 * money, and there are nine dialogs to get wrong.
 *
 * Overlay on desktop, bottom sheet below 640px, per the design. The sheet can
 * be pushed down to dismiss, which is the gesture a phone user will try first.
 */
export function Dialog({
  open,
  onClose,
  title,
  hideTitle = false,
  description,
  tone = 'default',
  actions,
  children,
  className,
}: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  const descriptionId = useId()
  const [drag, setDrag] = useState<number | null>(null)
  const startY = useRef(0)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (open && !el.open) el.showModal()
    if (!open && el.open) el.close()
  }, [open])

  // showModal() makes the background inert but does not stop it scrolling.
  useEffect(() => {
    if (!open) return
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previous
    }
  }, [open])

  const onPointerDown = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    // Mouse users have the backdrop and Escape; this is a touch affordance.
    if (e.pointerType === 'mouse') return
    startY.current = e.clientY
    setDrag(0)
    e.currentTarget.setPointerCapture(e.pointerId)
  }, [])

  const onPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (drag === null) return
      // Downward only. Dragging a sheet upward should do nothing rather than
      // lift it off the edge it belongs to.
      setDrag(Math.max(0, e.clientY - startY.current))
    },
    [drag],
  )

  const onPointerUp = useCallback(() => {
    if (drag === null) return
    const dismissed = drag > DISMISS_AFTER_PX
    setDrag(null)
    if (dismissed) onClose()
  }, [drag, onClose])

  const destructive = tone === 'destructive'

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      data-dragging={drag !== null ? 'true' : undefined}
      style={drag !== null ? ({ '--ot-sheet-drag': `${drag}px` } as React.CSSProperties) : undefined}
      onClose={onClose}
      // A click that lands on the dialog element itself is a backdrop click:
      // the panel inside covers everything else.
      onClick={(e) => {
        if (e.target === ref.current) onClose()
      }}
      className={cn('ot-dialog', className)}
    >
      <div
        className={cn(
          'ot-dialog-panel flex flex-col gap-4 border bg-[var(--ot-card)] p-[18px]',
          'shadow-[var(--ot-shadow-card)]',
          'sm:w-[min(420px,calc(100vw-2rem))] sm:rounded-[16px] sm:p-[22px]',
          destructive ? 'border-[var(--ot-block-border)]' : 'border-[var(--ot-border)]',
        )}
      >
        {/* Grab handle. Touch only — it is the sheet's affordance, and on a
            desktop overlay there is nothing to grab. */}
        <div
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          className="-m-[18px] mb-0 cursor-grab touch-none p-[18px] pb-2 active:cursor-grabbing sm:hidden"
        >
          <span
            aria-hidden
            className="mx-auto block h-1 w-[38px] rounded-[999px] bg-[var(--ot-border-strong)]"
          />
        </div>

        <div className="flex flex-col gap-[5px]">
          <h2
            id={titleId}
            className={cn(
              hideTitle ? 'sr-only' : 'font-display text-[18px] font-bold sm:text-[19px]',
              !hideTitle && destructive && 'text-[var(--ot-block-text)]',
            )}
          >
            {title}
          </h2>
          {description ? (
            <p id={descriptionId} className="text-[13px] leading-[1.5] text-[var(--ot-text-2)]">
              {description}
            </p>
          ) : null}
        </div>

        {children}

        {actions ? <div className="flex flex-col gap-2">{actions}</div> : null}
      </div>
    </dialog>
  )
}
