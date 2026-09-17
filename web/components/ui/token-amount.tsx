import { cn } from '@/lib/cn'
import { formatAmount } from '@/lib/format'

export interface TokenAmountProps {
  /** Integer base units as a string. Never a number — precision would be lost. */
  value: string
  decimals: number
  symbol?: string
  /** Signed rendering for balance deltas on a review page. */
  direction?: 'in' | 'out' | 'neutral'
  className?: string
}

const DIRECTION_CLASS = {
  in: 'text-[var(--ot-ok-text)]',
  out: 'text-[var(--ot-text)]',
  neutral: 'text-[var(--ot-text)]',
} as const

/**
 * Amounts are tabular so digits align down a column of balance changes, and a
 * differing magnitude is visible as a differing width.
 */
export function TokenAmount({
  value,
  decimals,
  symbol,
  direction = 'neutral',
  className,
}: TokenAmountProps) {
  const formatted = formatAmount(value, decimals)
  const sign = direction === 'in' ? '+' : direction === 'out' ? '−' : ''

  return (
    <span
      className={cn(
        'font-mono text-[14px] font-medium tabular-nums tracking-[-0.02em]',
        DIRECTION_CLASS[direction],
        className,
      )}
    >
      {sign}
      {formatted}
      {symbol ? <span className="ml-1 text-[var(--ot-text-3)]">{symbol}</span> : null}
    </span>
  )
}
