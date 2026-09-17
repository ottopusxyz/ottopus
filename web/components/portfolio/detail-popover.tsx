'use client'

import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '@/lib/cn'

/**
 * The tooltip's own width, in pixels. Declared once because the clamp that keeps
 * it on screen and the element that renders it have to agree — when they drift,
 * the tooltip runs off the right edge on exactly the cells that need it most.
 */
const WIDTH = 264

/** Kept off the viewport edge by this much, and off the trigger by the same. */
const MARGIN = 12

/** Room the tooltip needs below the trigger before it flips above it. */
const HEADROOM = 200

/** Hover, keyboard focus, or tap reveals details without changing the table layout. */
export function DetailPopover({ label, children, detail, title, className }: {
  label: string; children: ReactNode; detail: ReactNode; title?: string; className?: string
}) {
  const id = useId()
  const trigger = useRef<HTMLButtonElement>(null)
  const tooltip = useRef<HTMLDivElement>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [position, setPosition] = useState<{ left: number; top: number; caret: number; above: boolean } | null>(null)
  function cancelClose() { if (timer.current) clearTimeout(timer.current) }
  function show() {
    cancelClose()
    document.dispatchEvent(new CustomEvent('portfolio-detail-open', { detail: id }))
    const rect = trigger.current?.getBoundingClientRect()
    if (!rect) return
    const above = window.innerHeight - rect.bottom < HEADROOM && rect.top > HEADROOM
    // Centred on the trigger, then pulled back inside the viewport. A balance
    // cell is right-aligned, so left-aligning the tooltip to it points the
    // detail away from the number it belongs to.
    const anchor = rect.left + rect.width / 2
    const left = Math.max(MARGIN, Math.min(anchor - WIDTH / 2, window.innerWidth - WIDTH - MARGIN))
    setPosition({
      left,
      top: above ? rect.top - MARGIN : rect.bottom + MARGIN,
      caret: Math.max(16, Math.min(anchor - left, WIDTH - 16)),
      above,
    })
  }
  function closeSoon() {
    cancelClose()
    timer.current = setTimeout(() => setPosition(null), 120)
  }
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])
  const open = position !== null
  useEffect(() => {
    if (!open) return
    const close = () => setPosition(null)
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') close() }
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !trigger.current?.contains(event.target) && !tooltip.current?.contains(event.target)) close()
    }
    const otherOpened = (event: Event) => {
      if ((event as CustomEvent<string>).detail !== id) close()
    }
    document.addEventListener('portfolio-detail-open', otherOpened)
    window.addEventListener('keydown', escape)
    window.addEventListener('scroll', close, true)
    window.addEventListener('resize', close)
    document.addEventListener('pointerdown', outside)
    return () => {
      document.removeEventListener('portfolio-detail-open', otherOpened)
      window.removeEventListener('keydown', escape)
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('resize', close)
      document.removeEventListener('pointerdown', outside)
    }
  }, [open, id])
  return (
    <>
      <button ref={trigger} type="button" aria-label={label} aria-describedby={open ? id : undefined}
        onMouseEnter={show} onMouseLeave={closeSoon} onFocus={show} onBlur={closeSoon}
        onClick={show} onKeyDown={(event) => { if (event.key === 'Escape') setPosition(null) }}
        className={cn('min-w-0 cursor-pointer rounded-md focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--ot-plan)]', className)}>
        {children}
      </button>
      {position ? createPortal(
        <div ref={tooltip} id={id} role="tooltip" onMouseEnter={cancelClose} onMouseLeave={closeSoon}
          style={{
            left: position.left,
            top: position.top,
            width: WIDTH,
            transform: position.above ? 'translateY(-100%)' : undefined,
            '--ot-detail-caret': `${position.caret}px`,
          } as React.CSSProperties}
          className={cn(
            'ot-detail-pop fixed z-[100] max-w-[calc(100vw-24px)] rounded-[var(--ot-radius-md)]',
            'border border-[var(--ot-border-strong)] bg-[var(--ot-card)] px-3.5 py-3',
            'text-[12px] leading-[1.5] text-[var(--ot-text)] shadow-xl',
            position.above ? 'ot-detail-pop--above' : 'ot-detail-pop--below',
          )}>
          {title ? (
            <p className="mb-1.5 text-[10px] font-semibold tracking-[0.06em] text-[var(--ot-text-3)] uppercase">{title}</p>
          ) : null}
          {detail}
        </div>, document.body,
      ) : null}
    </>
  )
}
