import type { HTMLAttributes } from 'react'
import { cn } from '@/lib/cn'

export type Tone = 'neutral' | 'plan' | 'ok' | 'warn' | 'block' | 'coral'

/**
 * Tinted background with matching text — never a solid fill with white on it.
 * Each pair is the contrast-checked combination from the design tokens.
 */
export const TONE_CLASSES: Record<Tone, string> = {
  neutral: 'bg-[var(--ot-surface-3)] text-[var(--ot-text-2)]',
  plan: 'bg-[var(--ot-plan-bg)] text-[var(--ot-plan-text)]',
  ok: 'bg-[var(--ot-ok-bg)] text-[var(--ot-ok-text)]',
  warn: 'bg-[var(--ot-warn-bg)] text-[var(--ot-warn-text)]',
  block: 'bg-[var(--ot-block-bg)] text-[var(--ot-block-text)]',
  coral: 'bg-[var(--ot-coral-soft)] text-[var(--ot-coral-text)]',
}

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: Tone
}

export function Badge({ tone = 'neutral', className, ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex w-fit items-center gap-1.5 rounded-[var(--ot-radius-pill)]',
        'px-2.5 py-1 text-[12px] font-medium leading-none whitespace-nowrap',
        TONE_CLASSES[tone],
        className,
      )}
      {...props}
    />
  )
}
