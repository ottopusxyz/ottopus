import type { HTMLAttributes } from 'react'
import { cn } from '@/lib/cn'

/**
 * A neutral chip carries a fact — a chain, a device, a wallet kind.
 *
 * Deliberately not the same component as Badge or StatusChip: those carry
 * state, and the design system is explicit that "neutral chips carry facts,
 * state chips carry state and nothing else". Conflating them lets a fact borrow
 * the visual weight of a warning.
 *
 * Facts use the small radius; state uses the pill. Neither is ever a clickable
 * filter — a chip that looks pressable implies a filter that does not exist.
 */
export function Chip({ className, ...props }: HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cn(
        'inline-flex w-fit items-center gap-1.5 rounded-[var(--ot-radius-sm)]',
        'bg-[var(--ot-surface-3)] px-2.5 py-1 text-[12px] font-medium leading-none',
        'whitespace-nowrap text-[var(--ot-text-2)]',
        className,
      )}
      {...props}
    />
  )
}
