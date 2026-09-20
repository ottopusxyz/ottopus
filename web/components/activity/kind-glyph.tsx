import type { ActivityKind } from '@/lib/api'
import { cn } from '@/lib/cn'

/**
 * One glyph per kind, drawn as a 16px stroke in the row's leading circle —
 * the same place the requests table puts the asset. An arrow up leaves, an
 * arrow down arrives, two arrows trade, a tray holds a protocol, a padlock
 * is an allowance, and everything else is a page: a call to a contract.
 */
const PATHS: Record<ActivityKind, string> = {
  send: 'M8 13V3M4 7l4-4 4 4',
  receive: 'M8 3v10M4 9l4 4 4-4',
  trade: 'M3 5.5h9l-2.5-2.5M13 10.5H4l2.5 2.5',
  deposit: 'M8 2v7M5 6l3 3 3-3M3 11v2a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1v-2',
  withdraw: 'M8 9V2M5 5l3-3 3 3M3 11v2a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1v-2',
  approve: 'M4.5 7.5V5.5a3.5 3.5 0 0 1 7 0v2M3.5 7.5h9v6h-9z',
  revoke: 'M4.5 7.5V5.5a3.5 3.5 0 0 1 6.2-2.2M3.5 7.5h9v6h-9zM6.5 10.5l3 0',
  claim: 'M3 8h10v5.5H3zM3 6h10v2H3zM8 6v7.5M5.5 6c-1.5 0-2.5-1-2.5-2s1-1.5 2-1c1 .5 3 3 3 3s2-2.5 3-3c1-.5 2 0 2 1s-1 2-2.5 2',
  mint: 'M8 3v10M3 8h10',
  burn: 'M8 2.5c1 2 3.5 3.5 3.5 6.5a3.5 3.5 0 0 1-7 0c0-1.2.5-2 1-2.5 0 1 .5 1.5 1 1.5.5-1.5 1-3 1.5-5.5z',
  execute: 'M4 2h5l3 3v9H4zM9 2v3h3M6 8h4M6 11h4',
  deploy: 'M8 2l5.5 3v6L8 14l-5.5-3V5zM8 8l5.5-3M8 8v6M8 8L2.5 5',
  delegate: 'M6 4.5a2 2 0 1 0 0 .1M2.5 13c0-2 1.5-3.5 3.5-3.5M10 8l3 2.5-3 2.5M8 10.5h5',
  revoke_delegation: 'M6 4.5a2 2 0 1 0 0 .1M2.5 13c0-2 1.5-3.5 3.5-3.5M13 8l-3 2.5 3 2.5M8 10.5h5',
  bid: 'M3 13h10M5 13V8h6v5M8 2v6M5.5 4.5L8 2l2.5 2.5',
}

export interface KindGlyphProps {
  kind: ActivityKind
  /** Reverted, so the glyph reads in the block tone instead of the neutral one. */
  failed?: boolean
  className?: string
}

export function KindGlyph({ kind, failed = false, className }: KindGlyphProps) {
  return (
    <span
      aria-hidden
      className={cn(
        'inline-flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-full ring-1',
        failed
          ? 'bg-[var(--ot-block-bg)] text-[var(--ot-block-text)] ring-[var(--ot-block-bg)]'
          : 'bg-[var(--ot-surface-3)] text-[var(--ot-text-2)] ring-[var(--ot-border)]',
        className,
      )}
    >
      <svg viewBox="0 0 16 16" width={16} height={16} fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
        <path d={PATHS[kind]} />
      </svg>
    </span>
  )
}
