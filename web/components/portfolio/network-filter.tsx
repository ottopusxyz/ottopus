'use client'

import { useEffect, useRef, useState } from 'react'
import type { ChainRow } from '@/lib/api'
import { cn } from '@/lib/cn'
import { AssetIcon } from './asset-icon'

export interface NetworkFilterProps {
  chains: readonly ChainRow[]
  value: string | null
  onChange: (chainId: string | null) => void
  className?: string
}

export function NetworkFilter({ chains, value, onChange, className }: NetworkFilterProps) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const selected = chains.find((chain) => chain.chainId === value)
  useEffect(() => {
    if (!open) return
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false)
    }
    document.addEventListener('pointerdown', outside)
    return () => document.removeEventListener('pointerdown', outside)
  }, [open])
  if (chains.length < 2) return null
  const options = [{ chainId: null, name: 'All networks', iconUrl: null }, ...chains]
  return (
    <div ref={root} className={cn('relative', className)}
      onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false) }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') { setOpen(false); trigger.current?.focus() }
        if (open && ['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
          const buttons = [...(root.current?.querySelectorAll<HTMLButtonElement>('[data-network-option]') ?? [])]
          const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
          const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
            : (index + (event.key === 'ArrowUp' ? -1 : 1) + buttons.length) % buttons.length
          event.preventDefault()
          buttons[next]?.focus()
        }
      }}>
      <button ref={trigger} type="button" aria-expanded={open} aria-label={`Filter by network: ${selected?.name ?? 'All networks'}`}
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 rounded-full border border-[var(--ot-border)] bg-[var(--ot-card)] px-3 py-2 text-[12px] font-medium shadow-sm transition-colors hover:bg-[var(--ot-surface-3)]">
        {selected ? <AssetIcon url={selected.iconUrl} name={selected.name} size={20} /> : (
          <span aria-hidden className="flex -space-x-2 pr-1">
            {chains.slice(0, 3).map((chain) => <AssetIcon key={chain.chainId} url={chain.iconUrl} name={chain.name} size={20} className="ring-2 ring-[var(--ot-card)]" />)}
          </span>
        )}
        <span className="max-w-32 truncate">{selected?.name ?? 'All networks'}</span>
        <svg aria-hidden viewBox="0 0 12 12" className={cn('h-3 w-3 transition-transform', open && 'rotate-180')}>
          <path d="m3 4.5 3 3 3-3" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open ? (
        <div className="absolute right-0 top-full z-30 mt-2 max-h-80 w-60 overflow-y-auto rounded-2xl border border-[var(--ot-border)] bg-[var(--ot-card)] p-1.5 shadow-xl" role="group" aria-label="Networks">
          {options.map((chain) => (
            <button key={chain.chainId ?? 'all'} type="button" data-network-option aria-pressed={value === chain.chainId}
              onClick={() => { onChange(chain.chainId); setOpen(false); trigger.current?.focus() }}
              className={cn('flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] transition-colors hover:bg-[var(--ot-surface-3)]', value === chain.chainId && 'bg-[var(--ot-surface-3)] font-semibold')}>
              {chain.chainId ? <AssetIcon url={chain.iconUrl} name={chain.name} size={24} /> : (
                <svg aria-hidden viewBox="0 0 24 24" className="h-6 w-6 text-[var(--ot-text-3)]" fill="none" stroke="currentColor" strokeWidth="1.3">
                  <circle cx="12" cy="12" r="9" /><ellipse cx="12" cy="12" rx="4" ry="9" /><path d="M3 12h18M5 6.5h14M5 17.5h14" />
                </svg>
              )}
              <span className="flex-1 truncate">{chain.name}</span>
              {value === chain.chainId ? <span aria-hidden>✓</span> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}
