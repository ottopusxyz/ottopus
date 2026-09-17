import { OttoBadge } from './otto-badge'
import { cn } from '@/lib/cn'

export type LockupTone = 'default' | 'reversed' | 'ink' | 'coral'

export interface LockupProps {
  /** Badge beside the word, badge above it, or the word with Otto as its o. */
  layout?: 'horizontal' | 'stacked' | 'wordmark'
  tone?: LockupTone
  /** Height of the badge in px. The word scales from it. */
  size?: number
  className?: string
}

/**
 * The lockup is a composition, not an exported image: the badge next to the
 * word set in the display face. That is how the design project builds it, and
 * it means the word stays real text — selectable, and correct at any size.
 *
 * Never uses the solid Otto. The design system is explicit that no logo lockup
 * takes the contour-free treatment.
 */
const TONE_TEXT: Record<LockupTone, string> = {
  default: 'text-[var(--ot-text)]',
  reversed: 'text-[var(--ot-cream)]',
  ink: 'text-[var(--ot-navy)]',
  coral: 'text-[var(--ot-coral)]',
}

export function Lockup({
  layout = 'horizontal',
  tone = 'default',
  size = 40,
  className,
}: LockupProps) {
  const mono = tone !== 'default'
  const monoColor =
    tone === 'reversed' ? 'var(--ot-cream)' : tone === 'coral' ? 'var(--ot-coral)' : 'var(--ot-navy)'

  const badge = (
    <OttoBadge
      size={size}
      mono={mono}
      monoColor={monoColor}
      // Below 24px the outlined ring turns to mud.
      tier={size < 24 ? 'icon' : 'outlined'}
    />
  )

  // Word size follows the badge, matching the design project's proportions.
  const wordPx = layout === 'stacked' ? size * 0.42 : size * 0.7

  const word = (
    <span
      className={cn('font-display font-bold tracking-[-0.03em] leading-none', TONE_TEXT[tone])}
      style={{ fontSize: `${wordPx}px` }}
    >
      ottopus
    </span>
  )

  if (layout === 'wordmark') {
    // The second o is Otto. Sized in em so it tracks the text, not the badge.
    return (
      <span
        className={cn(
          'inline-flex items-center font-display font-bold tracking-[-0.03em] leading-none',
          TONE_TEXT[tone],
          className,
        )}
        style={{ fontSize: `${size}px` }}
        // The badge is decorative here; the accessible name is the whole word.
        aria-label="ottopus"
        role="img"
      >
        <span aria-hidden>ott</span>
        <span aria-hidden className="mx-[0.03em] inline-flex self-center">
          <OttoBadge size={size * 0.8} mono={mono} monoColor={monoColor} />
        </span>
        <span aria-hidden>pus</span>
      </span>
    )
  }

  return (
    <span
      role="img"
      aria-label="ottopus"
      className={cn(
        'inline-flex',
        layout === 'stacked' ? 'flex-col items-center gap-3' : 'items-center gap-[0.2em]',
        className,
      )}
    >
      <span aria-hidden className="flex-none">
        {badge}
      </span>
      <span aria-hidden>{word}</span>
    </span>
  )
}
