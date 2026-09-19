'use client'

import { useCallback, useState } from 'react'
import { Otto, OttoBadge } from '@/components/brand'
import { Button, Card } from '@/components/ui'
import { cn } from '@/lib/cn'
import { INTENT_PROMPTS } from './prompts'

/** The design's first prompt, kept under its old name for whoever imports it. */
export const EXAMPLE_PROMPT = INTENT_PROMPTS[0]!

type CopyState = 'idle' | 'copied' | 'failed'

export interface IntentNudgeProps {
  /**
   * `card` is the rail's full card: Otto at 52px, the copy line, the prompt,
   * the buttons. `compact` is the sidebar's: Otto at 36px, the prompt, the
   * buttons, in 188px.
   */
  variant?: 'card' | 'compact'
  /** What to suggest. Led by something personal when the caller has a reading. */
  prompts?: readonly string[]
  className?: string
}

/**
 * The intent nudge. Otto asks to be tried, and keeps asking.
 *
 * It used to carry "Not now" and a stored dismissal, and then it was gone for
 * good from a page whose whole point is that an agent can be asked. Now it is
 * always somewhere — the rail, the sidebar, or a pill — and instead of a way
 * out it has a way on: Next cycles the prompts, so someone who does not want
 * the first suggestion sees a second rather than closing the card.
 */
export function IntentNudge({ variant = 'card', prompts = INTENT_PROMPTS, className }: IntentNudgeProps) {
  const [index, setIndex] = useState(0)
  const [copy, setCopy] = useState<CopyState>('idle')
  // A new list — the reading arrived, the network filter moved — starts over
  // at its lead, which is the one written for this person. Derived during
  // render rather than in an effect, so the old list's prompt is never drawn.
  const [seen, setSeen] = useState(prompts)
  if (seen !== prompts) {
    setSeen(prompts)
    setIndex(0)
  }
  const list = prompts.length > 0 ? prompts : INTENT_PROMPTS
  const prompt = list[index % list.length]!

  const next = useCallback(() => {
    setIndex((i) => i + 1)
    setCopy('idle')
  }, [])

  const onCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(prompt)
      setCopy('copied')
    } catch {
      setCopy('failed')
    }
  }, [prompt])

  const status = (
    <span role="status" className={cn('text-[var(--ot-text-3)]', variant === 'compact' ? 'text-[11px]' : 'text-[12px]')}>
      {copy === 'copied' ? 'Copied' : copy === 'failed' ? 'Could not reach the clipboard — select the prompt to copy it.' : ''}
    </span>
  )

  if (variant === 'compact') {
    return (
      <div className={cn('flex flex-col gap-2 rounded-[12px] bg-[var(--ot-surface-2)] p-3', className)}>
        <div className="flex items-center gap-2">
          <div className="ot-drift flex-none">
            <Otto pose="base" size={36} animated />
          </div>
          <span className="text-[12px] leading-[1.4] text-[var(--ot-text-2)]">Try me with something small.</span>
        </div>
        <p className="m-0 rounded-[8px] bg-[var(--ot-card)] px-2.5 py-2 text-[12px] leading-[1.45]">&ldquo;{prompt}&rdquo;</p>
        <div className="flex flex-wrap items-center gap-1.5">
          <Button variant="secondary" size="sm" className="text-[12px]" onClick={onCopy}>
            Copy
          </Button>
          <Button variant="ghost" size="sm" className="text-[12px]" onClick={next} aria-label="Next prompt">
            Next
          </Button>
          {status}
        </div>
      </div>
    )
  }

  return (
    <div className={cn('mt-auto border-t border-[var(--ot-border)] px-5 py-[18px] sm:px-[26px]', className)}>
      <Card raised className="flex flex-col gap-[13px] p-[18px]">
        <div className="flex items-start gap-[11px]">
          <div className="ot-drift flex-none">
            <Otto pose="base" size={52} animated />
          </div>
          <p className="m-0 text-[14px] leading-[1.5]">
            Nothing to request for yet. Try me with something small — I&rsquo;ll show you the whole
            plan before anything is signed.
          </p>
        </div>

        <p className="m-0 rounded-[10px] bg-[var(--ot-surface-2)] px-3 py-[10px] text-[13px]">&ldquo;{prompt}&rdquo;</p>

        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" size="sm" onClick={onCopy}>
            Copy prompt
          </Button>
          <Button variant="ghost" size="sm" onClick={next} aria-label="Next prompt">
            Next
          </Button>
          {status}
        </div>
      </Card>
    </div>
  )
}

/** The old name. Same component. */
export const FirstIntentNudge = IntentNudge

/** The pill: Otto's badge and two words, the size of a button. */
function TryOttoPill({ onClick, className }: { onClick: () => void; className?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={false}
      className={cn(
        'inline-flex cursor-pointer items-center gap-2 rounded-full border border-[var(--ot-border-strong)] bg-[var(--ot-card)] py-[7px] pr-3.5 pl-2.5',
        'text-[13px] font-semibold shadow-[var(--ot-shadow-card)] transition-colors hover:bg-[var(--ot-surface-2)]',
        className,
      )}
    >
      <OttoBadge tier="icon" size={22} animate="idle" />
      Try Otto
    </button>
  )
}

/**
 * The sidebar's nudge: the pill at rest, the compact card when asked, and
 * the pill again on Close. Same shape as the corner overlay, so "Try Otto"
 * means one thing wherever it is.
 */
export function SidebarNudge({ prompts, className }: Pick<IntentNudgeProps, 'prompts' | 'className'>) {
  const [open, setOpen] = useState(false)
  if (!open) return <TryOttoPill onClick={() => setOpen(true)} className={cn('w-full justify-center', className)} />
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <IntentNudge variant="compact" prompts={prompts} />
      <Button variant="ghost" size="sm" className="w-fit text-[12px]" onClick={() => setOpen(false)}>
        Close
      </Button>
    </div>
  )
}

/**
 * The nudge where there is no rail: a pill in the corner that opens into the
 * card and closes again.
 *
 * The card cannot be dismissed any more, and a card that cannot be dismissed
 * cannot sit on top of a table of balances either. So at rest it is a pill
 * the size of a button, and it is the person who decides when it is a card.
 * Nothing is remembered between visits — it opens closed.
 */
export function IntentNudgeOverlay({ prompts, className }: Pick<IntentNudgeProps, 'prompts' | 'className'>) {
  const [open, setOpen] = useState(false)

  if (!open) return <TryOttoPill onClick={() => setOpen(true)} className={cn('absolute right-3 bottom-3 z-20', className)} />

  return (
    <div
      className={cn(
        'ot-scroll absolute right-3 bottom-3 left-3 z-20 max-h-[45dvh] overflow-y-auto rounded-2xl bg-[var(--ot-card)] shadow-lg sm:left-auto sm:w-[400px]',
        className,
      )}
    >
      <IntentNudge prompts={prompts} className="border-t-0" />
      <div className="px-5 pb-3 sm:px-[26px]">
        <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
          Close
        </Button>
      </div>
    </div>
  )
}
