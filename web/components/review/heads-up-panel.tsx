'use client'

import { Otto } from '@/components/brand'
import { Callout } from '@/components/ui'
import type { Plan } from '@/lib/api'
import { cn } from '@/lib/cn'
import { approvalAmount, headsUp } from './model'

/**
 * What to read before signing: every approval the plan grants and every
 * warning above info, each in its own callout, under Otto in his heads-up
 * pose.
 *
 * Moved out of the card because the card is a decision and these are an
 * argument. Three callouts between the amount and the button pushed the
 * button off a phone screen and made the amount harder to find; now the
 * card says "two things to read first" and points here. Beside the card on
 * a wide screen, under it on a phone — never folded away.
 */
export interface HeadsUpPanelProps {
  plan: Plan
  className?: string
}

/** The anchor the card's label jumps to on a narrow screen. */
export const HEADS_UP_ID = 'heads-up'

export function HeadsUpPanel({ plan, className }: HeadsUpPanelProps) {
  const { grants, warnings, count, worst } = headsUp(plan)
  if (count === 0) return null

  return (
    <section
      id={HEADS_UP_ID}
      aria-label="Heads-up"
      className={cn(
        'flex scroll-mt-4 flex-col gap-3 rounded-[16px] border bg-[var(--ot-card)] px-[18px] py-4',
        worst === 'block' ? 'border-[var(--ot-block-border)]' : 'border-[var(--ot-warn-border)]',
        className,
      )}
    >
      <header className="flex items-center gap-3">
        <Otto pose="heads-up" size={52} animated label="Otto, heads up" />
        <div className="flex flex-col gap-px">
          <h2 className="m-0 text-[13.5px] font-semibold">Heads-up</h2>
          <p className="m-0 text-[11.5px] leading-[1.45] text-[var(--ot-text-3)]">
            {count === 1 ? 'One thing' : `${count} things`} to read before you sign. Nothing here signs anything.
          </p>
        </div>
      </header>

      {grants.map((grant) => (
        <Callout
          key={`${grant.asset}-${grant.spender}`}
          compact
          severity={grant.unlimited ? 'block' : 'caution'}
          title={grant.unlimited ? 'This spender wants unlimited token access.' : 'This plan grants an approval.'}
        >
          <span className="block">
            Spender <code className="font-mono text-[11.5px]">{grant.spender.split(':').pop()}</code>
            {grant.spenderName ? ` · ${grant.spenderName}` : ''}
          </span>
          <span className="block">
            Amount <code className="font-mono text-[11.5px] font-semibold">{approvalAmount(plan, grant)}</code>
          </span>
        </Callout>
      ))}
      {warnings.map((w) => (
        <Callout key={w.code + w.message} compact severity={w.severity === 'block' ? 'block' : 'caution'} title={w.message}>
          {w.saferAlternative}
        </Callout>
      ))}
    </section>
  )
}
