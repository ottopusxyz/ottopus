import type { InputHTMLAttributes } from 'react'
import { cn } from '@/lib/cn'

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  /**
   * Mono with tabular figures. On for anything the user must read character by
   * character — an address, a one-time code, a hash.
   */
  mono?: boolean
  /** Draws the error border. Pair it with a message; a red box alone says nothing. */
  invalid?: boolean
}

/**
 * The design's field treatment: recessed rather than raised, so it reads as
 * somewhere to put something instead of something to press.
 */
export function Input({ mono = false, invalid = false, className, ...props }: InputProps) {
  return (
    <input
      aria-invalid={invalid || undefined}
      className={cn(
        'w-full min-w-0 rounded-[10px] border bg-[var(--ot-surface-2)] px-3 py-[10px]',
        'text-[14px] text-[var(--ot-text)] placeholder:text-[var(--ot-text-4)]',
        'transition-colors duration-[var(--ot-dur-fast)]',
        mono && 'font-mono text-[13px] tabular-nums',
        invalid ? 'border-[var(--ot-block-border)]' : 'border-[var(--ot-border-strong)]',
        'disabled:cursor-not-allowed disabled:text-[var(--ot-text-4)]',
        className,
      )}
      {...props}
    />
  )
}
