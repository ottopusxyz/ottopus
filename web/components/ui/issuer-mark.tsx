import type { HTMLAttributes } from 'react'
import { cn } from '@/lib/cn'
import { issuerMark, issuerName } from '@/lib/stocks'

export interface IssuerMarkProps extends HTMLAttributes<HTMLSpanElement> {
  /** The service's word for the issuer: `bstock`, `ondo`, `xstocks`. */
  issuer: string
  /** The underlying's ticker, for the title. */
  ticker: string
}

/**
 * The issuer's mark beside a tokenized stock's symbol: "NVDAB ◎ bStock".
 *
 * A fact, not a state, so it takes the chip's small radius and neutral tint
 * and none of the badge tones: a stock is not a warning and not a success.
 * Smaller than a chip because it sits inside a symbol's line, and the
 * issuer's casing is kept because it is their name.
 *
 * The mark sits on a cream tile in both themes, like the agent marks: these
 * are third-party marks drawn for a light ground, and Ondo's is black. An
 * issuer we have no file for keeps the word alone.
 */
export function IssuerMark({ issuer, ticker, className, ...props }: IssuerMarkProps) {
  const name = issuerName(issuer)
  const mark = issuerMark(issuer)
  return (
    <span
      title={`Tokenized stock issued by ${name}, tracking ${ticker}`}
      className={cn(
        'inline-flex shrink-0 items-center gap-1 rounded-[var(--ot-radius-sm)]',
        'bg-[var(--ot-surface-3)] py-0.5 pr-1.5 text-[10px] font-medium leading-none',
        mark ? 'pl-0.5' : 'pl-1.5',
        'whitespace-nowrap text-[var(--ot-text-2)]',
        className,
      )}
      {...props}
    >
      {mark ? (
        <span
          aria-hidden
          className="flex h-3.5 w-3.5 flex-none items-center justify-center overflow-hidden rounded-[3px] bg-[var(--ot-cream)] ring-1 ring-[var(--ot-border)]"
        >
          {/* A static asset from our own public directory; next/image would add an
              optimiser round trip for a 500-byte SVG it cannot optimise anyway. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={mark} alt="" width={10} height={10} />
        </span>
      ) : null}
      {name}
    </span>
  )
}
