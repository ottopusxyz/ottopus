import { OttoBadge } from '@/components/brand'
import { cn } from '@/lib/cn'
import { BubbleField } from '../bubble-field'

export interface LoaderStep {
  label: string
  status: 'done' | 'active' | 'pending'
}

export interface StepPanelProps {
  title: string
  steps: readonly LoaderStep[]
  className?: string
}

/**
 * L3 · Step panel — a 2 to 15 second wait, inside a panel or a dialog.
 *
 * Named steps rather than a percentage: "a wallet handshake can't be measured,
 * but it can be narrated." Badge tier, not the full mascot, because this sits
 * inside a modal and two Otto loaders must never share a screen.
 *
 * Every step is rendered whatever its status, so advancing one never reflows
 * the list — a list that resizes as it progresses is harder to read than one
 * that simply changes colour.
 */
export function StepPanel({ title, steps, className }: StepPanelProps) {
  return (
    <div
      role="status"
      className={cn(
        'ot-depth relative flex flex-col items-center gap-[14px] overflow-hidden',
        'rounded-[14px] border border-[var(--ot-border)] px-[22px] py-[26px]',
        className,
      )}
    >
      <BubbleField pattern="calm" />
      <div className="ot-drift relative">
        <OttoBadge tier="outlined" size={72} />
      </div>
      <p className="font-display relative m-0 text-[17px] font-bold">{title}</p>

      <ol className="relative flex w-full max-w-[230px] list-none flex-col gap-[6px] p-0">
        {steps.map((step) => (
          <li key={step.label} className="flex items-center gap-2 text-[13px]">
            {step.status === 'done' ? (
              <>
                <span aria-hidden className="font-bold text-[var(--ot-ok-text)]">
                  ✓
                </span>
                <span className="text-[var(--ot-ok-text)]">{step.label}</span>
              </>
            ) : step.status === 'active' ? (
              <>
                <span aria-hidden className="inline-flex gap-[3px]">
                  {[0, 1, 2].map((i) => (
                    <span
                      key={i}
                      className="ot-dot h-[5px] w-[5px] rounded-full bg-[var(--ot-plan)]"
                      style={{ animationDelay: `${i * 0.2}s` }}
                    />
                  ))}
                </span>
                <span className="text-[var(--ot-text)]">{step.label}</span>
              </>
            ) : (
              <>
                <span aria-hidden className="w-[13px] text-center opacity-50">
                  ·
                </span>
                <span className="text-[var(--ot-text-3)]">{step.label}</span>
              </>
            )}
          </li>
        ))}
      </ol>
    </div>
  )
}
