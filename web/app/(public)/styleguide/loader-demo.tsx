'use client'

import { InkHold, StepPanel } from '@/components/motion'

/**
 * The two loaders that take a handler. A server component cannot pass a
 * function across the boundary, so the demo lives on this side of it — which
 * is also where a real screen would call these from.
 */
export function LoaderDemo() {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="flex flex-col gap-2">
        <span className="text-[11px] tracking-[0.14em] text-[var(--ot-text-3)] uppercase">
          L3 · Step panel — 2–15s
        </span>
        <StepPanel
          title="Linking Coral wallet"
          steps={[
            { label: 'Signature received', status: 'done' },
            { label: 'Reading balances', status: 'active' },
            { label: 'Restoring caps', status: 'pending' },
          ]}
        />
      </div>
      <div className="flex flex-col gap-2">
        <span className="text-[11px] tracking-[0.14em] text-[var(--ot-text-3)] uppercase">
          L6 · Ink hold — on-chain
        </span>
        <InkHold
          title="Waiting on the chain"
          detail="1 of 2 confirmations · ~24s"
          onEscape={() => {}}
        />
      </div>
    </div>
  )
}
