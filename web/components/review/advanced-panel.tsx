'use client'

import { Badge } from '@/components/ui'
import type { BinanceSimulation, Plan } from '@/lib/api'
import { explorerAddressUrl, explorerName } from '@/lib/chains'
import { cn } from '@/lib/cn'
import { truncateAddress } from '@/lib/format'
import {
  chainOfPlan,
  liveRefusal,
  decodedRows,
  preparedBy,
  recipientOf,
  simulationNote,
  verificationSummary,
} from './model'
import { type CallVerdict, callVerdicts, type SecondOpinion, secondOpinion } from './second-opinion'
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
  /** Binance's simulation of the same plan, once it has answered. Advice only. */
  binance?: BinanceSimulation | null | undefined
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

export function AdvancedPanel({ plan, live, binance, decoderUrl, bare = false, className }: AdvancedPanelProps) {
  const chain = chainOfPlan(plan)
  const decoded = decodedRows(plan)
  const verification = verificationSummary(plan)
  const run = live?.run ?? null
  const note = simulationNote(plan, run)
  const recipient = recipientOf(plan)
  const running = live?.kind === 'running'
  // The card carries a mark; the sentence behind it belongs here.
  const refusal = liveRefusal(run ?? plan.simulation)
  const second = binance ? secondOpinion(plan, run ?? plan.simulation, binance) : null
  const verdicts = binance ? callVerdicts(binance, decoded.length) : null

  return (
    <section
      className={cn(
        'flex min-w-0 flex-col gap-3.5',
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
          <p className="m-0 rounded-[10px] bg-[var(--ot-block-bg)] px-2.5 py-2 text-[11.5px] leading-[1.45] font-medium [overflow-wrap:anywhere] text-[var(--ot-block-text)]">
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
              <div className="flex min-w-0 flex-col gap-0.5">
                <code className="min-w-0 truncate font-mono text-[12px] font-semibold">{row.signature}</code>
                {row.implementation ? (
                  <span className="truncate text-[11px] text-[var(--ot-text-3)]">
                    clone of {row.contractName ?? 'its implementation'} at {truncateAddress(row.implementation)}
                  </span>
                ) : null}
              </div>
              <div className="flex flex-none items-center gap-2">
                {verdicts?.[i] ? <BinanceVerdict verdict={verdicts[i]} /> : null}
                <Badge tone={row.verified ? 'ok' : row.isContract ? 'warn' : 'neutral'}>
                  {row.verified ? 'verified' : row.isContract ? 'unverified' : 'wallet'}
                </Badge>
              </div>
            </div>
          ))}
        </div>
        {second ? <BinanceField opinion={second} /> : null}
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
              Recipient on {explorerName(chain)}
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
 * What each decoded call says about Binance's run of it: Binance's mark and
 * a small glyph, never a filled badge, because the sign button does not
 * listen to this. A later call Binance refused wears a caution and not a
 * failure: it ran that call without the ones before it.
 */
const VERDICTS: Record<CallVerdict, { words: string; ink: string }> = {
  passed: { words: 'Binance simulation passes', ink: 'text-[var(--ot-ok-text)]' },
  failed: { words: 'Binance simulation fails', ink: 'text-[var(--ot-block-text)]' },
  dependent: {
    words: 'Binance simulation fails on its own: this call relies on the one before it',
    ink: 'text-[var(--ot-warn-text)]',
  },
  skipped: { words: 'Binance simulation not run', ink: 'text-[var(--ot-text-3)]' },
}

function BinanceVerdict({ verdict }: { verdict: CallVerdict }) {
  const { words, ink } = VERDICTS[verdict]
  return (
    <span role="img" aria-label={words} title={words} className={cn('flex flex-none items-center gap-1', ink)}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/wallets/binance_wallet.svg" alt="" width={14} height={14} className="rounded-[3px]" />
      <svg aria-hidden viewBox="0 0 12 12" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        {verdict === 'passed' ? (
          <path d="M2.5 6.4l2.3 2.3 4.7-5.2" />
        ) : verdict === 'failed' ? (
          <path d="M3 3l6 6M9 3l-6 6" />
        ) : verdict === 'dependent' ? (
          <path d="M6 1.6l4.8 8.6H1.2zM6 5v2.3M6 8.7v.1" strokeWidth="1.3" />
        ) : (
          <path d="M3 6h6" />
        )}
      </svg>
    </span>
  )
}

/**
 * The rest of a second simulator's reading, under the calls it was run on
 * and labelled as what it is: where it differs from the page's own run, why
 * it failed, and the allowances it saw. It informs and never decides.
 */
function BinanceField({ opinion }: { opinion: SecondOpinion }) {
  if (opinion.kind === 'unavailable') {
    return <p className="m-0 text-[11.5px] leading-[1.45] text-[var(--ot-text-3)]">{opinion.line}</p>
  }
  return (
    <div className="flex flex-col gap-1.5">
      {opinion.kind === 'failed' ? (
        <p className="m-0 text-[12px] leading-[1.45] [overflow-wrap:anywhere] text-[var(--ot-text-2)]">
          Fails at Binance: {opinion.reason}
        </p>
      ) : opinion.allowances.length > 0 ? (
        <div className="flex flex-col gap-1">
          <span className="text-[11px] font-medium text-[var(--ot-text-3)]">Allowances, as Binance sees them</span>
          <ul className="m-0 flex list-none flex-col gap-1 p-0 text-[12px]">
            {opinion.allowances.map((row, i) => (
              <li key={i} className="flex flex-col">
                <span className="font-medium">
                  {row.token} to <code className="font-mono text-[11.5px]">{row.spender}</code>
                </span>
                <span className="text-[var(--ot-text-2)]">
                  {row.before} → {row.after}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {opinion.note ? (
        <p className="m-0 text-[11.5px] leading-[1.45] font-medium text-[var(--ot-text-2)]">{opinion.note}</p>
      ) : null}
      <p className="m-0 text-[11px] leading-[1.45] text-[var(--ot-text-3)]">{opinion.provenance}</p>
    </div>
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
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="m-0 text-[13px] font-semibold">{title}</h2>
        {action}
      </div>
      {/* A revert reason is one unbroken run of hex: let it break anywhere. */}
      {note ? (
        <p className="m-0 text-[11.5px] leading-[1.45] [overflow-wrap:anywhere] text-[var(--ot-text-3)]">{note}</p>
      ) : null}
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
