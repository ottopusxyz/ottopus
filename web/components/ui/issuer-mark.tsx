import type { HTMLAttributes } from 'react'
import { cn } from '@/lib/cn'
import { issuerName } from '@/lib/stocks'

export interface IssuerMarkProps extends HTMLAttributes<HTMLSpanElement> {
  /** The service's word for the issuer: `bstock`, `ondo`, `xstocks`. */
  issuer: string
  /** The underlying's ticker, for the title. */
  ticker: string
}

/**
 * The issuer's mark beside a tokenized stock's symbol: "NVDAB bStock".
 *
 * A fact, not a state, so it takes the chip's small radius and neutral tint
 * and none of the badge tones: a stock is not a warning and not a success.
 * Smaller than a chip because it sits inside a symbol's line, and the
 * issuer's casing is kept because it is their name.
 */
export function IssuerMark({ issuer, ticker, className, ...props }: IssuerMarkProps) {
  const name = issuerName(issuer)
  return (
    <span
      title={`Tokenized stock issued by ${name}, tracking ${ticker}`}
      className={cn(
        'inline-flex shrink-0 items-center rounded-[var(--ot-radius-sm)]',
        'bg-[var(--ot-surface-3)] px-1.5 py-0.5 text-[10px] font-medium leading-none',
        'whitespace-nowrap text-[var(--ot-text-2)]',
        className,
      )}
      {...props}
    >
      {name}
    </span>
  )
}
