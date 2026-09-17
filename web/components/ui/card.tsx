import type { HTMLAttributes } from 'react'
import { cn } from '@/lib/cn'

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  /** Lifts the card off the page. Off by default — most surfaces sit flat. */
  raised?: boolean
}

export function Card({ raised = false, className, ...props }: CardProps) {
  return (
    <div
      className={cn(
        'rounded-[var(--ot-radius-md)] border border-[var(--ot-border)] bg-[var(--ot-card)]',
        raised && 'shadow-[var(--ot-shadow-card)]',
        className,
      )}
      {...props}
    />
  )
}

export function CardHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('px-5 pt-5 pb-3', className)} {...props} />
}

export function CardTitle({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h3
      className={cn(
        'font-[var(--ot-font-display)] text-[17px] font-semibold tracking-[-0.02em] text-[var(--ot-text)]',
        className,
      )}
      {...props}
    />
  )
}

export function CardBody({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('px-5 pb-5', className)} {...props} />
}
