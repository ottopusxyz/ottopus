'use client'

import type { Plan } from '@/lib/api'
import type { BrowserSimulation } from '@/lib/simulate'
import { SOURCE_LABEL, changeSource, liveRefusal, simulationNote } from './model'
import type { SimulationState } from './use-simulation'

/**
 * What the page says about its own simulation, under the asset rows.
 *
 * Never silent. A diff shown without saying where it came from is a claim
 * the evidence does not support, and rows shown with no note let a reader
 * assume a simulation ran when none did. Three things always appear: which
 * source the rows came from, who produced it and at which block, and that a
 * simulation is a prediction.
 */

export interface LiveSimulation {
  kind: SimulationState['kind']
  run: BrowserSimulation | null
  again: () => void
}

export interface SimulationPanelProps {
  plan: Plan
  live?: LiveSimulation | undefined
  /** A neutral third-party decode of the calldata. Keyless, opens in a new tab. */
  visualiseUrl?: string | null
}

export function SimulationPanel({ plan, live, visualiseUrl }: SimulationPanelProps) {
  const run = live?.run ?? null
  const source = changeSource(plan, run)
  const note = simulationNote(plan, run)
  const refusal = liveRefusal(run)
  const running = live?.kind === 'running'
  const unavailable = live?.kind === 'unavailable' && source !== 'live'

  return (
    <div className="flex flex-col gap-2">
      {refusal ? (
        <p className="m-0 rounded-[10px] bg-[var(--ot-block-soft)] px-2.5 py-2 text-[12px] leading-[1.45] font-medium text-[var(--ot-block-text)]">
          {refusal} Nothing has been signed.
        </p>
      ) : null}

      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <p className="m-0 text-[11.5px] leading-[1.45] text-[var(--ot-text-3)]">
          {running
            ? 'Simulating against the chain right now…'
            : unavailable
              ? `No chain would answer a simulation from this browser${
                  source === 'stored' ? '; the rows above are the run from when the plan was built.' : '.'
                }`
              : (note ?? 'No simulation ran for this chain. The decoded call below is what was checked.')}
        </p>
        {live && !running ? (
          <button
            type="button"
            onClick={live.again}
            className="cursor-pointer rounded-full border border-[var(--ot-border)] px-2 py-[3px] text-[11px] font-medium text-[var(--ot-text-2)] transition-colors hover:bg-[var(--ot-surface-3)]"
          >
            Simulate again
          </button>
        ) : null}
      </div>

      {run?.success && run.gasUsed !== '0' ? (
        <p className="m-0 font-mono text-[11px] text-[var(--ot-text-3)]">
          {Number(run.gasUsed).toLocaleString()} gas · {SOURCE_LABEL[source]}
        </p>
      ) : null}

      {visualiseUrl ? (
        <a
          href={visualiseUrl}
          target="_blank"
          rel="noreferrer"
          className="w-fit text-[12px] font-medium text-[var(--ot-plan-text)] underline decoration-[var(--ot-plan)]/40 underline-offset-2"
        >
          Check this calldata in an independent decoder
        </a>
      ) : null}
    </div>
  )
}
