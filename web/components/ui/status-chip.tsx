import { Badge, type Tone } from './badge'
import { cn } from '@/lib/cn'

/**
 * The one status vocabulary, shared by review, activity and settings.
 *
 * These are the frozen plan statuses. They must match PLAN_STATUSES in the
 * service and the plan_events check constraint in the database — the service
 * has a test asserting that. Adding a status here without adding it there means
 * a plan the UI can render and the database will refuse.
 */
export const PLAN_STATUSES = [
  'draft',
  'awaiting_review',
  'awaiting_signature',
  'submitted',
  'confirmed',
  'failed',
  'expired',
  'blocked',
  'superseded',
  'cancelled',
] as const

export type PlanStatus = (typeof PLAN_STATUSES)[number]

/**
 * Wording is deliberately plain rather than mascot copy. "Inked" is what the
 * illustration does; the chip has to say what happened.
 */
const LABELS: Record<PlanStatus, string> = {
  draft: 'Draft',
  awaiting_review: 'To review',
  awaiting_signature: 'To sign',
  submitted: 'Submitted',
  confirmed: 'Confirmed',
  failed: 'Failed',
  expired: 'Expired',
  blocked: 'Blocked',
  superseded: 'Replaced',
  cancelled: 'Cancelled',
}

const TONES: Record<PlanStatus, Tone> = {
  draft: 'neutral',
  awaiting_review: 'plan',
  awaiting_signature: 'plan',
  submitted: 'plan',
  confirmed: 'ok',
  failed: 'block',
  expired: 'neutral',
  blocked: 'block',
  superseded: 'neutral',
  cancelled: 'neutral',
}

/** Statuses that still need something from the user. */
const NEEDS_YOU: ReadonlySet<PlanStatus> = new Set(['awaiting_review', 'awaiting_signature'])

export interface StatusChipProps {
  status: PlanStatus
  className?: string
}

export function StatusChip({ status, className }: StatusChipProps) {
  return (
    <Badge
      tone={TONES[status]}
      className={cn(NEEDS_YOU.has(status) && 'font-semibold', className)}
      // Screen readers get the same word the chip shows, not the raw enum.
      aria-label={`Status: ${LABELS[status]}`}
    >
      {LABELS[status]}
    </Badge>
  )
}

export { LABELS as PLAN_STATUS_LABELS }
