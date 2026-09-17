import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'

export interface PageHeaderProps {
  /**
   * The page's name. Always rendered as the route's one h1 — visually hidden
   * when a figure takes its place, because "Total balance" reads better on
   * screen than "Portfolio" but a screen reader still needs to know where it is.
   */
  title: string
  /** Small line above the headline: what the number counts, or a summary. */
  eyebrow?: ReactNode
  /** The headline. Use Figure for a currency total. */
  headline?: ReactNode
  /** One line under the headline — a delta, a count, a timestamp. */
  detail?: ReactNode
  /** Secondary action, top right. Never the page's primary action. */
  action?: ReactNode
  className?: string
}

/**
 * The band at the top of every page inside the shell.
 *
 * Shared rather than per-screen: portfolio, requests, activity and settings all
 * have one, and four copies is how the padding and the hairline drift apart.
 */
export function PageHeader({
  title,
  eyebrow,
  headline,
  detail,
  action,
  className,
}: PageHeaderProps) {
  const visibleTitle = !headline

  return (
    <div
      className={cn(
        'flex flex-wrap items-start justify-between gap-5',
        'border-b border-[var(--ot-border)] px-5 pt-5 pb-4 sm:px-[26px] sm:pt-6 sm:pb-5',
        className,
      )}
    >
      <div className="flex min-w-0 flex-col gap-1">
        <h1
          className={cn(
            visibleTitle
              ? 'font-display text-[24px] font-bold tracking-[-0.02em]'
              : 'sr-only',
          )}
        >
          {title}
        </h1>
        {eyebrow ? <span className="text-[13px] text-[var(--ot-text-3)]">{eyebrow}</span> : null}
        {headline}
        {detail ? <span className="text-[13px] text-[var(--ot-text-2)]">{detail}</span> : null}
      </div>
      {action}
    </div>
  )
}

export interface FigureProps {
  /** Already formatted, without the fractional part. */
  whole: string
  /** The cents. Dimmed — the dollars are what you read first. */
  fraction?: string
  className?: string
}

/**
 * A headline number. Mono and tabular so it does not reflow as it updates, at
 * the one size the design uses for a page's leading figure.
 */
export function Figure({ whole, fraction, className }: FigureProps) {
  return (
    <span
      className={cn(
        'font-mono text-[32px] leading-none font-semibold tabular-nums',
        'tracking-[-0.02em] sm:text-[40px]',
        className,
      )}
    >
      {whole}
      {fraction ? <span className="text-[var(--ot-text-3)]">.{fraction}</span> : null}
    </span>
  )
}
