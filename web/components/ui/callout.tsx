import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'

export type CalloutSeverity = 'info' | 'caution' | 'block' | 'ok'

/**
 * The banner that says something needs attention — an unlimited approval, a
 * contract deployed minutes ago, a simulation that failed.
 *
 * The title takes the state colour; the body stays full text colour. That is
 * deliberate in the design system: tinting the explanation makes it read as
 * decoration, and the explanation is the part that has to be read carefully.
 *
 * A warning with no alternative just induces clicking, so actions belong here
 * rather than elsewhere on the page — "Cap to 1,250" beside "Keep unlimited".
 */
const SEVERITY: Record<CalloutSeverity, { bg: string; title: string }> = {
  info: { bg: 'bg-[var(--ot-plan-bg)]', title: 'text-[var(--ot-plan-text)]' },
  caution: { bg: 'bg-[var(--ot-warn-bg)]', title: 'text-[var(--ot-warn-text)]' },
  block: { bg: 'bg-[var(--ot-block-bg)]', title: 'text-[var(--ot-block-text)]' },
  ok: { bg: 'bg-[var(--ot-ok-bg)]', title: 'text-[var(--ot-ok-text)]' },
}

export interface CalloutProps {
  severity?: CalloutSeverity
  title: string
  children?: ReactNode
  /** Otto, once the mascot lands in #48. A 44px square slot. */
  icon?: ReactNode
  actions?: ReactNode
  className?: string
}

export function Callout({
  severity = 'caution',
  title,
  children,
  icon,
  actions,
  className,
}: CalloutProps) {
  const tone = SEVERITY[severity]
  return (
    <div
      // Assertive would interrupt a screen reader mid-sentence while someone is
      // reading a transaction. Polite still announces before they can sign.
      role="status"
      className={cn('flex gap-3.5 rounded-[10px] p-4', tone.bg, className)}
    >
      {icon ? (
        <div aria-hidden className="h-11 w-11 flex-none">
          {icon}
        </div>
      ) : null}
      <div className="flex flex-col gap-1">
        <p className={cn('text-[15px] font-semibold', tone.title)}>{title}</p>
        {children ? (
          <div className="text-[14px] leading-[1.5] text-[var(--ot-text)]">{children}</div>
        ) : null}
        {actions ? <div className="mt-2 flex flex-wrap gap-2">{actions}</div> : null}
      </div>
    </div>
  )
}

/** Inline mono for a value quoted inside callout prose, e.g. 2²⁵⁶−1 USDC. */
export function CalloutValue({ children }: { children: ReactNode }) {
  return <code className="font-mono text-[13px]">{children}</code>
}
