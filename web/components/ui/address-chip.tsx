'use client'

import { useState } from 'react'
import { cn } from '@/lib/cn'
import { addressOf, truncateAddress } from '@/lib/format'

export interface AddressChipProps {
  /** A CAIP-10 identifier or a bare address. */
  address: string
  /** Show the whole thing. Recipients on a review page should never truncate. */
  full?: boolean
  copyable?: boolean
  className?: string
}

/**
 * Addresses are always mono, so digits line up and a substituted character is
 * visible rather than absorbed by proportional spacing.
 *
 * Truncation is a display choice with teeth: middle-truncating hides the part
 * of an address an attacker would vary. Pass `full` anywhere the value is being
 * checked rather than merely recognised — a transfer recipient, an approval
 * spender.
 *
 * Casing is shown as given. Checksummed display needs keccak, which arrives
 * with the wallet work; storage and comparison stay lowercase either way.
 */
export function AddressChip({ address, full = false, copyable = true, className }: AddressChipProps) {
  const [copied, setCopied] = useState(false)
  const bare = addressOf(address)
  const shown = full ? bare : truncateAddress(bare)

  async function copy() {
    try {
      await navigator.clipboard.writeText(bare)
      setCopied(true)
      setTimeout(() => setCopied(false), 1400)
    } catch {
      // Clipboard can be blocked by permissions; the address is still visible.
    }
  }

  const body = (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-[var(--ot-radius-sm)]',
        'border border-[var(--ot-border)] bg-[var(--ot-card)] px-2.5 py-1',
        'font-mono text-[13px] text-[var(--ot-text)]',
        full ? 'break-all' : 'whitespace-nowrap',
        className,
      )}
    >
      {shown}
      {copied && <span className="text-[11px] text-[var(--ot-ok-text)]">copied</span>}
    </span>
  )

  if (!copyable) return body

  return (
    <button
      type="button"
      onClick={copy}
      // The accessible name carries the full address; the visible text may be
      // truncated, and a screen reader user cannot see what was elided.
      aria-label={`Copy address ${bare}`}
      className="cursor-pointer rounded-[var(--ot-radius-sm)] transition-opacity hover:opacity-80"
    >
      {body}
    </button>
  )
}
