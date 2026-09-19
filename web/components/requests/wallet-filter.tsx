'use client'

import { useEffect, useRef, useState } from 'react'
import { WalletMark, type WalletRef } from '@/components/portfolio/wallet-marks'
import { Button, Dialog, SHEET_MEDIA } from '@/components/ui'
import { cn } from '@/lib/cn'
import { useMediaQuery } from '@/lib/use-media-query'
import type { WalletOption } from './plans'

export interface WalletFilterProps {
  wallets: readonly (WalletOption & { ref: WalletRef })[]
  value: string
  onChange: (caip10: string) => void
}

/**
 * The wallet picker on the requests header — the portfolio's network filter,
 * with wallets in it. A dropdown anchored to the chip on a wide screen and a
 * bottom sheet on a phone, the same rows in both.
 */
export function WalletFilter({ wallets, value, onChange }: WalletFilterProps) {
  const [open, setOpen] = useState(false)
  const sheet = useMediaQuery(SHEET_MEDIA)
  const root = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const selected = wallets.find((w) => w.caip10 === value)

  useEffect(() => {
    if (!open || sheet) return
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false)
    }
    document.addEventListener('pointerdown', outside)
    return () => document.removeEventListener('pointerdown', outside)
  }, [open, sheet])

  if (wallets.length < 2) return null

  const pick = (caip10: string) => {
    onChange(caip10)
    setOpen(false)
    if (!sheet) trigger.current?.focus()
  }

  const rows = (rowClassName: string) => (
    <>
      <button
        type="button"
        aria-pressed={value === 'all'}
        onClick={() => pick('all')}
        className={cn(
          'flex w-full cursor-pointer items-center gap-2.5 rounded-lg text-left transition-colors hover:bg-[var(--ot-surface-3)]',
          'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--ot-plan)]',
          rowClassName,
          value === 'all' && 'bg-[var(--ot-surface-3)] font-semibold',
        )}
      >
        <span aria-hidden className="flex -space-x-2 pr-1">
          {wallets.slice(0, 3).map((w) => (
            <WalletMark key={w.caip10} wallet={w.ref} size={22} className="ring-2 ring-[var(--ot-card)]" />
          ))}
        </span>
        <span className="flex-1 truncate">All wallets</span>
        <span className="text-[11px] text-[var(--ot-text-3)]">{wallets.length}</span>
        {value === 'all' ? <span aria-hidden>✓</span> : null}
      </button>
      {wallets.map((w) => (
        <button
          key={w.caip10}
          type="button"
          aria-pressed={value === w.caip10}
          onClick={() => pick(w.caip10)}
          className={cn(
            'flex w-full cursor-pointer items-center gap-2.5 rounded-lg text-left transition-colors hover:bg-[var(--ot-surface-3)]',
            'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--ot-plan)]',
            rowClassName,
            value === w.caip10 && 'bg-[var(--ot-surface-3)] font-semibold',
          )}
        >
          <WalletMark wallet={w.ref} size={24} />
          <span className="flex-1 truncate">{w.label}</span>
          <span className="text-[11px] text-[var(--ot-text-3)]">{w.count}</span>
          {value === w.caip10 ? <span aria-hidden>✓</span> : null}
        </button>
      ))}
    </>
  )

  return (
    <div
      ref={root}
      className="relative"
      onBlur={(event) => {
        if (!sheet && !event.currentTarget.contains(event.relatedTarget)) setOpen(false)
      }}
      onKeyDown={(event) => {
        if (!sheet && event.key === 'Escape') {
          setOpen(false)
          trigger.current?.focus()
        }
      }}
    >
      <button
        ref={trigger}
        type="button"
        aria-expanded={open}
        aria-haspopup={sheet ? 'dialog' : undefined}
        aria-label={`Filter by wallet: ${selected?.label ?? 'All wallets'}`}
        onClick={() => setOpen(!open)}
        className="flex cursor-pointer items-center gap-2 rounded-full border border-[var(--ot-border)] bg-[var(--ot-card)] px-3 py-2 text-[12px] font-medium shadow-sm transition-colors hover:bg-[var(--ot-surface-3)]"
      >
        {selected ? (
          <WalletMark wallet={selected.ref} size={20} />
        ) : (
          <span aria-hidden className="flex -space-x-2 pr-1">
            {wallets.slice(0, 3).map((w) => (
              <WalletMark key={w.caip10} wallet={w.ref} size={20} className="ring-2 ring-[var(--ot-card)]" />
            ))}
          </span>
        )}
        <span className="max-w-32 truncate">{selected?.label ?? 'All wallets'}</span>
        <svg aria-hidden viewBox="0 0 12 12" className={cn('h-3 w-3 transition-transform', open && 'rotate-180')}>
          <path d="m3 4.5 3 3 3-3" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {sheet ? (
        <Dialog
          open={open}
          onClose={() => setOpen(false)}
          title="Wallet"
          description="The list follows the wallet you pick."
          className="[&_.ot-dialog-panel]:max-h-[85dvh]"
          actions={
            <Button variant="secondary" fullWidth onClick={() => setOpen(false)}>
              Close
            </Button>
          }
        >
          <div className="ot-scroll -mx-1 min-h-0 overflow-y-auto overscroll-contain" role="group" aria-label="Wallets">
            {rows('px-3 py-3 text-[14px]')}
          </div>
        </Dialog>
      ) : open ? (
        <div
          className="absolute right-0 top-full z-30 mt-2 max-h-80 w-64 overflow-y-auto rounded-2xl border border-[var(--ot-border)] bg-[var(--ot-card)] p-1.5 shadow-xl"
          role="group"
          aria-label="Wallets"
        >
          {rows('px-2.5 py-2 text-[13px]')}
        </div>
      ) : null}
    </div>
  )
}
