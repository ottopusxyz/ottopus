import type { ButtonHTMLAttributes } from 'react'
import { cn } from '@/lib/cn'

type Variant = 'primary' | 'secondary' | 'ghost' | 'destructive' | 'danger-outline' | 'link'
type Size = 'sm' | 'md' | 'lg'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
}

/**
 * Text on a solid fill always goes through --ot-on-state; white fails AA on the
 * green, amber and blue fills.
 *
 * The two destructive treatments are not interchangeable. Solid is for the
 * committed act — revoking a grant, unlinking a wallet — where destruction is
 * the point of the button. Outline is for rejecting beside an approve, where
 * red-on-red would compete with the primary action for the eye.
 *
 * Solid destructive uses --ot-block-surface rather than --ot-block-solid: the
 * fill is light in both modes so navy passes AA on it, which white on the
 * darker red does not in every context.
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
  'danger-outline':
    'border border-[var(--ot-block-solid)] bg-transparent text-[var(--ot-block-text)] hover:bg-[var(--ot-block-bg)]',
  // "Text action": underlined with a hairline rule, no pill. Distinct from
  // ghost, which is a quiet button rather than a link.
  link: 'border-none bg-transparent text-[var(--ot-text)] underline underline-offset-[3px] decoration-[var(--ot-border-strong)] hover:decoration-[var(--ot-text)]',
}

/** Sizes are the design system's three, not invented. */
const SIZES: Record<Size, string> = {
  sm: 'px-3.5 py-[7px] text-[13px]',
  md: 'px-[18px] py-[10px] text-[14px]',
  lg: 'px-5 py-[13px] text-[15px]',
}

/** The link variant sits tight to its text rather than carrying pill padding. */
const LINK_SIZES: Record<Size, string> = {
  sm: 'px-1 py-[7px] text-[13px]',
  md: 'px-1 py-[7px] text-[14px]',
  lg: 'px-1 py-[7px] text-[15px]',
}

/**
 * Disabled goes neutral rather than transparent. Fading a coral button leaves a
 * washed coral that still reads as the primary action; the design system drops
 * it to a plain surface so it reads as unavailable instead of merely faint.
 */
const DISABLED =
  'disabled:cursor-not-allowed disabled:border-[var(--ot-border)] disabled:bg-[var(--ot-surface-2)] disabled:text-[var(--ot-text-4)] disabled:hover:bg-[var(--ot-surface-2)] disabled:hover:brightness-100'

export function Button({
  variant = 'secondary',
  size = 'md',
  className,
  type = 'button',
  ...props
}: ButtonProps) {
  const isLink = variant === 'link'
  return (
    <button
      type={type}
      className={cn(
        'inline-flex items-center justify-center gap-2 whitespace-nowrap',
        isLink ? 'rounded-none' : 'rounded-[var(--ot-radius-pill)]',
        'font-ui font-medium leading-none cursor-pointer',
        'transition-colors duration-[var(--ot-dur-fast)] ease-[var(--ot-ease-out)]',
        VARIANTS[variant],
        isLink ? LINK_SIZES[size] : SIZES[size],
        !isLink && DISABLED,
        isLink && 'disabled:cursor-not-allowed disabled:text-[var(--ot-text-4)]',
        className,
      )}
      {...props}
    />
  )
}
