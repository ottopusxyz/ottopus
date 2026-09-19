'use client'

import { Badge } from '@/components/ui'
import type { Plan } from '@/lib/api'
import { chainName, explorerAddressUrl } from '@/lib/chains'
import { cn } from '@/lib/cn'
import {
  chainOfPlan,
  liveRefusal,
  decodedRows,
  preparedBy,
  recipientOf,
  simulationNote,
  verificationSummary,
} from './model'
import type { LiveSimulation } from './use-simulation'

/**
 * Everything a careful reader wants and a normal one does not: the decoded
 * calls, the raw bytes, the simulation's own numbers, and the identifiers
 * that make the plan checkable.
 *
 * Split out of the card because the card was answering two questions at once.
 * "Am I sending 500 USDC to the right person" is a five-second decision that
 * should fit on a screen with the button that acts on it; "what exactly does
 * this calldata do" is an investigation. Putting the second beside the first
 * on a wide screen, and behind one tap on a phone, lets the card be short
 * without hiding anything.
 *
 * Nothing here is exclusive to this panel. Anything that changes the decision
 * — a revert, an approval, an unverified contract — is also stated on the
 * card, because a warning nobody expands is not a warning.
 */

export interface AdvancedPanelProps {
  plan: Plan
  live?: LiveSimulation | undefined
  /** A neutral third-party decode of the calldata. Keyless. */
  decoderUrl?: string | null
  /**
   * Drop the panel's own card chrome. Set when it is nested inside the review
   * card on a narrow screen, where a bordered box inside a bordered box reads
   * as two things rather than one.
   */
  bare?: boolean
  className?: string
}

export function AdvancedPanel({ plan, live, decoderUrl, bare = false, className }: AdvancedPanelProps) {
  const chain = chainOfPlan(plan)
  const decoded = decodedRows(plan)
  const verification = verificationSummary(plan)
  const run = live?.run ?? null
  const note = simulationNote(plan, run)
  const recipient = recipientOf(plan)
  const running = live?.kind === 'running'
  // The card carries a mark; the sentence behind it belongs here.
  const refusal = liveRefusal(run ?? plan.simulation)

  return (
    <section
      className={cn(
        'flex flex-col gap-3.5',
        bare ? 'pb-4' : 'rounded-[16px] border border-[var(--ot-border)] bg-[var(--ot-card)] px-[18px] py-4',
        className,
      )}
    >
      {bare ? null : <h2 className="m-0 text-[13.5px] font-semibold">Advanced review</h2>}

      <Group
        title="Simulation"
        note={
          running
            ? 'Running against the chain right now…'
            : (note ?? 'No simulation ran. The decoded call below is what was checked.')
        }
        action={
          live && !running ? (
            <button
              type="button"
              onClick={live.again}
              className="cursor-pointer rounded-full border border-[var(--ot-border)] px-2 py-[3px] text-[11px] font-medium text-[var(--ot-text-2)] transition-colors hover:bg-[var(--ot-surface-3)]"
            >
              Run again
            </button>
          ) : null
        }
      >
        {refusal ? (
          <p className="m-0 rounded-[10px] bg-[var(--ot-block-bg)] px-2.5 py-2 text-[11.5px] leading-[1.45] font-medium text-[var(--ot-block-text)]">
            {refusal} Nothing has been signed.
          </p>
        ) : null}
        <Rows
          rows={[
            // Which run the rows above came from is on the card already; a
            // 280px panel has no room to say anything twice.
            ...(run ? ([['Block', run.blockNumber]] as [string, string][]) : []),
            ...(run?.gasUsed && run.gasUsed !== '0'
              ? ([['Gas', `${Number(run.gasUsed).toLocaleString()} units`]] as [string, string][])
              : []),
          ]}
        />
      </Group>

      <Group
        title={verification.allVerified ? 'Decoded and verified' : 'Decoded, not all verified'}
        note={`${decoded.length} ${decoded.length === 1 ? 'call' : 'calls'} · ${
          verification.contracts === 0
            ? 'no contracts touched'
            : verification.allVerified
              ? 'every contract has verified source'
              : 'some source is unverified'
        }`}
      >
        <div className="flex flex-col gap-px overflow-hidden rounded-[8px]">
          {decoded.map((row, i) => (
            <div key={i} className="flex items-center justify-between gap-2.5 bg-[var(--ot-water-1)] px-3 py-2.5">
              <code className="min-w-0 truncate font-mono text-[12px] font-semibold">{row.signature}</code>
              <Badge tone={row.verified ? 'ok' : row.isContract ? 'warn' : 'neutral'}>
                {row.verified ? 'verified' : row.isContract ? 'unverified' : 'wallet'}
              </Badge>
            </div>
          ))}
        </div>
        <div className="flex flex-col gap-1">
          {decoderUrl ? (
            <a
              href={decoderUrl}
              target="_blank"
              rel="noreferrer"
              className="w-fit text-[11.5px] font-medium text-[var(--ot-plan-text)] underline decoration-[var(--ot-plan)]/40 underline-offset-2"
            >
              Decode this elsewhere
            </a>
          ) : null}
          {recipient && explorerAddressUrl(chain, recipient.address) ? (
            <a
              href={explorerAddressUrl(chain, recipient.address)!}
              target="_blank"
              rel="noreferrer"
              className="w-fit text-[11.5px] font-medium text-[var(--ot-plan-text)] underline decoration-[var(--ot-plan)]/40 underline-offset-2"
            >
              Recipient on the {chainName(chain)} explorer
            </a>
          ) : null}
        </div>
      </Group>

      <Fold title="Raw calls" note="Byte for byte, as the wallet gets them">
        {decoded.map((row, i) => (
          <pre
            key={i}
            className="m-0 overflow-x-auto rounded-[8px] bg-[var(--ot-water-3)] px-2.5 py-2 font-mono text-[10px] leading-[1.6] break-all whitespace-pre-wrap text-[var(--ot-text-2)]"
          >
            {`to    ${row.raw.to}\nvalue ${row.raw.value}\ndata  ${row.raw.data}`}
          </pre>
        ))}
      </Fold>

      <Fold title="Identifiers" note="What makes this plan checkable">
        <Rows
          rows={[
            ['Prepared by', preparedBy(plan)],
            ['Provenance', plan.provenance === 'agent_crafted' ? 'Agent-crafted' : 'Built by Ottopus'],
            ['Hash', `${plan.planHash.slice(0, 14)}…`],
          ]}
        />
      </Fold>
    </section>
  )
}

/**
 * A section that stays shut until asked for.
 *
 * The panel is a reference, not a report: somebody opens it with a question,
 * and everything that is not the answer to that question is in the way. Raw
 * calldata and identifiers are each one line at rest and as long as they need
 * to be when opened.
 */
function Fold({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <details className="ot-review-details">
      <summary className="flex cursor-pointer list-none items-baseline justify-between gap-2 [&::-webkit-details-marker]:hidden">
        <span className="flex items-baseline gap-2">
          <span className="text-[13px] font-semibold">{title}</span>
          {note ? <span className="text-[11px] text-[var(--ot-text-3)]">{note}</span> : null}
        </span>
        <span className="ot-review-caret text-[11px] text-[var(--ot-text-3)]" aria-hidden>
          ▾
        </span>
      </summary>
      <div className="flex flex-col gap-2 pt-2">{children}</div>
    </details>
  )
}

function Group({
  title,
  note,
  action,
  children,
}: {
  title: string
  note?: string
  action?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="m-0 text-[13px] font-semibold">{title}</h2>
        {action}
      </div>
      {note ? <p className="m-0 text-[11.5px] leading-[1.45] text-[var(--ot-text-3)]">{note}</p> : null}
      {children}
    </div>
  )
}

/** Label/value pairs, tight. One row per fact and no borders: the panel is already a list. */
function Rows({ rows }: { rows: readonly [string, string][] }) {
  return (
    <dl className="m-0 flex flex-col gap-1 text-[12.5px]">
      {rows.map(([label, value], i) => (
        <div key={`${label}-${i}`} className="flex items-baseline justify-between gap-3">
          <dt className="flex-none text-[var(--ot-text-3)]">{label}</dt>
          <dd className="m-0 min-w-0 truncate text-right font-medium">{value}</dd>
        </div>
      ))}
    </dl>
  )
}
