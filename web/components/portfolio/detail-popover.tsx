'use client'

import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '@/lib/cn'

/** Hover, keyboard focus, or tap reveals details without changing the table layout. */
export function DetailPopover({ label, children, detail, className }: {
  label: string; children: ReactNode; detail: ReactNode; className?: string
}) {
  const id = useId()
  const trigger = useRef<HTMLButtonElement>(null)
  const tooltip = useRef<HTMLDivElement>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [position, setPosition] = useState<{ left: number; top: number; above: boolean } | null>(null)
  function cancelClose() { if (timer.current) clearTimeout(timer.current) }
  function show() {
    cancelClose()
    document.dispatchEvent(new CustomEvent('portfolio-detail-open', { detail: id }))
    const rect = trigger.current?.getBoundingClientRect()
    if (!rect) return
    const above = window.innerHeight - rect.bottom < 200 && rect.top > 200
    setPosition({ left: Math.max(12, Math.min(rect.left, window.innerWidth - 300)), top: above ? rect.top - 8 : rect.bottom + 8, above })
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
        className={cn('min-w-0 cursor-help rounded-md focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--ot-plan)]', className)}>
        {children}
      </button>
      {position ? createPortal(
        <div ref={tooltip} id={id} role="tooltip" onMouseEnter={cancelClose} onMouseLeave={closeSoon}
          style={{ left: position.left, top: position.top, transform: position.above ? 'translateY(-100%)' : undefined }}
          className="fixed z-[100] w-72 max-w-[calc(100vw-24px)] rounded-xl border border-[var(--ot-border-strong)] bg-[var(--ot-card)] p-3.5 text-[12px] text-[var(--ot-text)] shadow-xl">
          {detail}
        </div>, document.body,
      ) : null}
    </>
  )
}
