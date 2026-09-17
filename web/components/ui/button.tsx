import type { ButtonHTMLAttributes } from 'react'
import { cn } from '@/lib/cn'

type Variant = 'primary' | 'secondary' | 'ghost' | 'destructive' | 'link'
type Size = 'sm' | 'md'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
}

/**
 * Text on a solid fill always goes through --ot-on-state. White fails AA on the
 * green, amber and blue fills, and destructive uses --ot-block-surface — a light
 * fill in both themes — for the same reason.
 */
const VARIANTS: Record<Variant, string> = {
  primary:
    'border border-[var(--ot-coral)] bg-[var(--ot-coral)] text-[var(--ot-on-state)] hover:bg-[var(--ot-coral-hover)] hover:border-[var(--ot-coral-hover)]',
  secondary:
    'border border-[var(--ot-border-strong)] bg-[var(--ot-card)] text-[var(--ot-text)] hover:bg-[var(--ot-surface-2)]',
  ghost:
    'border border-transparent bg-transparent text-[var(--ot-text-2)] hover:bg-[var(--ot-surface-2)] hover:text-[var(--ot-text)]',
  destructive:
    'border border-[var(--ot-block-surface)] bg-[var(--ot-block-surface)] text-[var(--ot-on-state)] hover:brightness-95',
  // "Text action" in the design system: underlined, hairline-coloured rule, no
  // pill. Distinct from ghost, which is a quiet button rather than a link.
  link: 'border-none bg-transparent text-[var(--ot-text)] underline underline-offset-[3px] decoration-[var(--ot-border-strong)] hover:decoration-[var(--ot-text)]',
}

const SIZES: Record<Size, string> = {
  sm: 'px-3 py-[7px] text-[13px]',
  md: 'px-6 py-[13px] text-[15px]',
}

/** The link variant sits tight to its text rather than carrying pill padding. */
const LINK_SIZES: Record<Size, string> = {
  sm: 'px-1 py-[7px] text-[13px]',
  md: 'px-1 py-[7px] text-[14px]',
}

export function Button({
  variant = 'secondary',
  size = 'md',
  className,
  type = 'button',
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(
        'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-[var(--ot-radius-pill)]',
        'font-ui font-medium leading-none cursor-pointer',
        'transition-colors duration-[var(--ot-dur-fast)] ease-[var(--ot-ease-out)]',
        'disabled:cursor-not-allowed disabled:opacity-50',
        variant === 'link' ? 'rounded-none' : '',
        VARIANTS[variant],
        variant === 'link' ? LINK_SIZES[size] : SIZES[size],
        className,
      )}
      {...props}
    />
  )
}
