'use client'

import { useEffect, useRef, useState } from 'react'
import { Button, Dialog, SHEET_MEDIA } from '@/components/ui'
import type { ChainRow } from '@/lib/api'
import { cn } from '@/lib/cn'
import { useMediaQuery } from '@/lib/use-media-query'
import { AssetIcon } from './asset-icon'

export interface NetworkFilterProps {
  chains: readonly ChainRow[]
  value: string | null
  onChange: (chainId: string | null) => void
  className?: string
}

/** A chain row, or the "all" entry that has no chain. */
type Option = Pick<ChainRow, 'name' | 'iconUrl'> & { chainId: string | null }

/**
 * The network picker on the portfolio's tab bar.
 *
 * A dropdown anchored to the chip on a wide screen, and a bottom sheet on a
 * phone — the same list, in the shape the design gives every dialog below
 * 640px. A 240px dropdown pinned to the right edge of a 360px screen is a
 * list of 36px rows hanging off a chip, and it was the one control on the
 * page that did not reach for the thumb.
 *
 * The trigger is identical in both modes; only what it opens differs. That is
 * what lets the mode come from a media query that is false on the server
 * without the chip flashing between two shapes on every phone load.
 */
export function NetworkFilter({ chains, value, onChange, className }: NetworkFilterProps) {
  const [open, setOpen] = useState(false)
  const sheet = useMediaQuery(SHEET_MEDIA)
  const root = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const selected = chains.find((chain) => chain.chainId === value)

  // Outside-click is the dropdown's problem only. A sheet is modal: the
  // backdrop, Escape and the drag are the dialog's own ways out.
  useEffect(() => {
    if (!open || sheet) return
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false)
    }
    document.addEventListener('pointerdown', outside)
    return () => document.removeEventListener('pointerdown', outside)
  }, [open, sheet])

  if (chains.length < 2) return null
  const options: Option[] = [{ chainId: null, name: 'All networks', iconUrl: null }, ...chains]

  const pick = (chainId: string | null) => {
    onChange(chainId)
    setOpen(false)
    // The native dialog puts focus back on the trigger by itself; the
    // dropdown has to.
    if (!sheet) trigger.current?.focus()
  }

  return (
    <div
      ref={root}
      className={cn('relative', className)}
      onBlur={(event) => {
        if (!sheet && !event.currentTarget.contains(event.relatedTarget)) setOpen(false)
      }}
      onKeyDown={(event) => {
        if (sheet) return
        if (event.key === 'Escape') {
          setOpen(false)
          trigger.current?.focus()
        }
        if (open && ['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
          const buttons = [
            ...(root.current?.querySelectorAll<HTMLButtonElement>('[data-network-option]') ?? []),
          ]
          const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
          const next =
            event.key === 'Home'
              ? 0
              : event.key === 'End'
                ? buttons.length - 1
                : (index + (event.key === 'ArrowUp' ? -1 : 1) + buttons.length) % buttons.length
          event.preventDefault()
          buttons[next]?.focus()
        }
      }}
    >
      <button
        ref={trigger}
        type="button"
        aria-expanded={open}
        aria-haspopup={sheet ? 'dialog' : undefined}
        aria-label={`Filter by network: ${selected?.name ?? 'All networks'}`}
        onClick={() => setOpen(!open)}
        className="flex cursor-pointer items-center gap-2 rounded-full border border-[var(--ot-border)] bg-[var(--ot-card)] px-3 py-2 text-[12px] font-medium shadow-sm transition-colors hover:bg-[var(--ot-surface-3)]"
      >
        {selected ? (
          <AssetIcon url={selected.iconUrl} name={selected.name} size={20} />
        ) : (
          <span aria-hidden className="flex -space-x-2 pr-1">
            {chains.slice(0, 3).map((chain) => (
              <AssetIcon
                key={chain.chainId}
                url={chain.iconUrl}
                name={chain.name}
                size={20}
                className="ring-2 ring-[var(--ot-card)]"
              />
            ))}
          </span>
        )}
        <span className="max-w-32 truncate">{selected?.name ?? 'All networks'}</span>
        <svg aria-hidden viewBox="0 0 12 12" className={cn('h-3 w-3 transition-transform', open && 'rotate-180')}>
          <path d="m3 4.5 3 3 3-3" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {sheet ? (
        <Dialog
          open={open}
          onClose={() => setOpen(false)}
          title="Network"
          description="The total and the tokens follow the network you pick."
          className="[&_.ot-dialog-panel]:max-h-[85dvh]"
          actions={
            <Button variant="secondary" fullWidth onClick={() => setOpen(false)}>
              Close
            </Button>
          }
        >
          <div className="ot-scroll -mx-1 min-h-0 overflow-y-auto overscroll-contain" role="group" aria-label="Networks">
            <Options options={options} value={value} onPick={pick} rowClassName="px-3 py-3 text-[14px]" />
          </div>
        </Dialog>
      ) : open ? (
        <div
          className="absolute right-0 top-full z-30 mt-2 max-h-80 w-60 overflow-y-auto rounded-2xl border border-[var(--ot-border)] bg-[var(--ot-card)] p-1.5 shadow-xl"
          role="group"
          aria-label="Networks"
        >
          <Options options={options} value={value} onPick={pick} rowClassName="px-2.5 py-2 text-[13px]" />
        </div>
      ) : null}
    </div>
  )
}

/** The rows, shared by both shapes so the list cannot drift between them. */
function Options({
  options,
  value,
  onPick,
  rowClassName,
}: {
  options: readonly Option[]
  value: string | null
  onPick: (chainId: string | null) => void
  /** The sheet's rows are taller: 44px for a thumb rather than 36 for a pointer. */
  rowClassName: string
}) {
  return options.map((chain) => (
    <button
      key={chain.chainId ?? 'all'}
      type="button"
      data-network-option
      aria-pressed={value === chain.chainId}
      onClick={() => onPick(chain.chainId)}
      className={cn(
        'flex w-full cursor-pointer items-center gap-2.5 rounded-lg text-left transition-colors hover:bg-[var(--ot-surface-3)]',
        'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--ot-plan)]',
        rowClassName,
        value === chain.chainId && 'bg-[var(--ot-surface-3)] font-semibold',
      )}
    >
      {chain.chainId ? (
        <AssetIcon url={chain.iconUrl} name={chain.name} size={24} />
      ) : (
        <svg aria-hidden viewBox="0 0 24 24" className="h-6 w-6 text-[var(--ot-text-3)]" fill="none" stroke="currentColor" strokeWidth="1.3">
          <circle cx="12" cy="12" r="9" />
          <ellipse cx="12" cy="12" rx="4" ry="9" />
          <path d="M3 12h18M5 6.5h14M5 17.5h14" />
        </svg>
      )}
      <span className="flex-1 truncate">{chain.name}</span>
      {value === chain.chainId ? <span aria-hidden>✓</span> : null}
    </button>
  ))
}
