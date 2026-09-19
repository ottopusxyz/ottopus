'use client'

import type { ReactNode } from 'react'
import { Otto } from '@/components/brand'
import { AssetIcon } from '@/components/portfolio/asset-icon'
import { AddressChip, Badge, Callout } from '@/components/ui'
import { walletClientName, walletMark } from '@/components/wallets/naming'
import type { Plan, Visuals } from '@/lib/api'
import { chainName, explorerAddressUrl } from '@/lib/chains'
import { cn } from '@/lib/cn'
import { formatAmount } from '@/lib/format'
import { type LiveSimulation, SimulationPanel } from './simulation-panel'
import {
  approvals,
  assetChanges,
  changeSource,
  SOURCE_LABEL,
  assetWords,
  bannerWarnings,
  chainOfPlan,
  decodedRows,
  facts,
  preparedBy,
  recipientOf,
  verificationSummary,
} from './model'

/**
 * P4's card: asset changes lead, then the facts that matter, then one
 * expander for everything else. 390 wide on a phone, the same card centred on
 * a desktop. The footer is handed in — signing, or a terminal state — because
 * the card does not know what may happen to the plan, only what it is.
 */
export interface ReviewCardProps {
  plan: Plan
  /** "request #9611cc" — the short id in the header. */
  reference: string
  /** The countdown, or a status word when there is nothing to count. */
  clock: ReactNode
  /** Icons and wallet clients, looked up beside the plan. Absent draws letters and tiles. */
  visuals?: Visuals | undefined
  /** The browser's own run, which replaces the stored one on the rows above. */
  live?: LiveSimulation | undefined
  /** A prefilled third-party simulator link, when the chain has one. */
  visualiseUrl?: string | null
  children: ReactNode
}

const NO_VISUALS: Visuals = { assets: {}, chains: {}, wallets: {} }

export function ReviewCard({ plan, reference, clock, visuals = NO_VISUALS, live, visualiseUrl, children }: ReviewCardProps) {
  const chain = chainOfPlan(plan)
  const chainVisual = visuals.chains[chain] ?? null
  const signer = visuals.wallets[plan.resolution.account.caip10] ?? null
  const signerClient = signer ? walletClientName({ label: signer.label, walletType: signer.walletType }) : null
  const signerMark = signer ? walletMark(signer.walletType) : null
  const liveRun = live?.run ?? null
  const changes = assetChanges(plan, liveRun)
  const source = changeSource(plan, liveRun)
  const recipient = recipientOf(plan)
  const rows = facts(plan)
  const decoded = decodedRows(plan)
  const verification = verificationSummary(plan)
  const grants = approvals(plan)
  const warnings = bannerWarnings(plan)

  return (
    <article className="flex flex-col overflow-hidden rounded-[26px] border border-[var(--ot-border-strong)] bg-[var(--ot-card)] shadow-[var(--ot-shadow-card)] sm:rounded-[16px] sm:border-[var(--ot-border)]">
      <header className="flex items-center justify-between px-[18px] pt-4 pb-1.5">
        <span className="text-[15px] font-semibold">Review</span>
        <span className="font-mono text-[11.5px] text-[var(--ot-text-3)]">{reference}</span>
      </header>

      <div className="flex flex-col gap-[3px] px-[18px] pt-1.5 pb-3.5">
        <h1 className="m-0 font-[family-name:var(--ot-font-display)] text-[20px] leading-[1.28] font-bold tracking-[-0.01em]">
          {plan.humanPlan.summary}
        </h1>
        <p className="m-0 text-[13px] leading-[1.45] text-[var(--ot-text-2)]">{plan.resolution.reason}</p>
      </div>

      {/* Asset changes: what the simulation watched move, or the request when nothing ran. */}
      <section className="flex flex-col gap-3.5 bg-[var(--ot-water-1)] px-[18px] py-3.5">
        <span className="text-[11.5px] text-[var(--ot-text-3)]">Asset changes · {SOURCE_LABEL[source]}</span>
        <div className="flex flex-col gap-3">
          {changes.map((change) => (
            <div key={`${change.direction}-${change.assetId}`} className="flex items-center gap-[11px]">
              <span aria-hidden className="relative h-9 w-9 flex-none">
                <AssetIcon
                  url={visuals.assets[change.assetId]?.iconUrl ?? null}
                  name={change.symbol}
                  size={36}
                  className="text-[13px]"
                />
                {chainVisual?.iconUrl ? (
                  <span className="absolute -right-px -bottom-px h-[15px] w-[15px] overflow-hidden rounded-full border-2 border-[var(--ot-card)] bg-[var(--ot-card)]">
                    {/* Provider CDN, same as the portfolio's icons. */}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={chainVisual.iconUrl} alt="" className="h-full w-full object-cover" />
                  </span>
                ) : null}
              </span>
              <div className="flex min-w-0 flex-col gap-px">
                <code
                  className={cn(
                    'font-mono text-[19px] font-semibold tabular-nums tracking-[-0.01em]',
                    change.direction === 'in' ? 'text-[var(--ot-ok-text)]' : 'text-[var(--ot-text)]',
                  )}
                >
                  {change.direction === 'out' ? '−' : '+'}
                  {change.amount} {change.symbol}
                </code>
                <span className="text-[11.5px] text-[var(--ot-text-3)]">{change.where}</span>
              </div>
            </div>
          ))}
          {changes.length === 0 ? (
            <p className="m-0 text-[13px] text-[var(--ot-text-2)]">{plan.humanPlan.steps[0] ?? plan.humanPlan.summary}</p>
          ) : null}
        </div>
        <SimulationPanel plan={plan} live={live} visualiseUrl={visualiseUrl} />
        {recipient ? (
          <div className="flex flex-col gap-1.5">
            <span className="text-[11.5px] text-[var(--ot-text-3)]">
              Recipient{recipient.name ? ` · ${recipient.name}` : ''}
            </span>
            {/* The recipient is what is being checked, so it is never truncated. */}
            <AddressChip address={recipient.address} full />
            {explorerAddressUrl(chain, recipient.address) ? (
              <a
                href={explorerAddressUrl(chain, recipient.address)!}
                target="_blank"
                rel="noreferrer"
                className="text-[12px] text-[var(--ot-plan-text)]"
              >
                View on the {chainName(chain)} explorer
              </a>
            ) : null}
          </div>
        ) : null}
      </section>

      <div className="flex flex-col px-[18px] pt-0.5">
        {rows.map((fact) => {
          const tile =
            fact.label === 'Signing with' ? (
              <Tile mark={signerMark} fallback="◈" tone="bg-[var(--ot-navy-soft)] text-[var(--ot-text)]" />
            ) : fact.label === 'Network' ? (
              <Tile mark={chainVisual?.iconUrl ?? null} fallback={fact.value.slice(0, 1)} tone="bg-[var(--ot-surface-3)] text-[var(--ot-text-2)]" />
            ) : null
          // "Main · Rabby" with a label; "Rabby" over the address without one.
          const named = fact.label === 'Signing with' && signerClient
          const value = named ? (signer?.label ? `${signer.label} · ${signerClient}` : signerClient) : fact.value
          const detail = named && !signer?.label ? fact.value : fact.detail
          return (
            <div key={fact.label} className="flex items-center justify-between gap-3 border-t border-[var(--ot-border)] py-[11px]">
              <span className="flex min-w-0 items-center gap-2.5">
                {tile}
                <span className="text-[13.5px] text-[var(--ot-text-2)]">{fact.label}</span>
              </span>
              <span className="flex min-w-0 flex-col items-end gap-px text-right">
                <span className={cn('text-[13.5px] font-semibold', fact.mono && 'font-mono tabular-nums')}>{value}</span>
                {detail ? <span className="text-[11.5px] text-[var(--ot-text-3)]">{detail}</span> : null}
              </span>
            </div>
          )
        })}
        <div className="flex items-center justify-between gap-3 border-t border-[var(--ot-border)] py-[11px]">
          <span className="text-[13.5px] text-[var(--ot-text-2)]">Expires</span>
          <span className="font-mono text-[13.5px] font-semibold tabular-nums">{clock}</span>
        </div>

        {/* Deep details. Opens in place, never a dialog. */}
        <details className="ot-review-details border-t border-[var(--ot-border)]">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 py-3 [&::-webkit-details-marker]:hidden">
            <span className="flex items-center gap-2.5">
              <span
                aria-hidden
                className={cn(
                  'flex h-[26px] w-[26px] flex-none items-center justify-center rounded-[8px] text-[12px] font-bold',
                  verification.allVerified ? 'bg-[var(--ot-ok-bg)] text-[var(--ot-ok-text)]' : 'bg-[var(--ot-warn-bg)] text-[var(--ot-warn-text)]',
                )}
              >
                {verification.allVerified ? '✓' : '!'}
              </span>
              <span className="flex flex-col gap-px">
                <span className="text-[13.5px] font-semibold">
                  {verification.allVerified ? 'Decoded and verified' : 'Decoded, not all verified'}
                </span>
                <span className="text-[11.5px] text-[var(--ot-text-3)]">
                  {decoded.length} {decoded.length === 1 ? 'call' : 'calls'} ·{' '}
                  {verification.contracts === 0
                    ? 'no contracts'
                    : verification.allVerified
                      ? 'verified source'
                      : 'some source unverified'}
                </span>
              </span>
            </span>
            <span className="flex items-center gap-2 text-[12px] font-semibold text-[var(--ot-text-3)]">
              Deep details <span className="ot-review-caret" aria-hidden>▾</span>
            </span>
          </summary>
          <div className="flex flex-col gap-3 pb-3.5">
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
            <dl className="m-0 flex flex-col gap-1.5 text-[12.5px]">
              {decoded.map((row, i) =>
                row.contractName ? (
                  <div key={`c${i}`} className="flex items-baseline justify-between gap-3">
                    <dt className="text-[var(--ot-text-3)]">Contract</dt>
                    <dd className="m-0 text-right">
                      <code className="font-mono text-[11.5px]">{row.raw.to.slice(0, 6)}…{row.raw.to.slice(-4)}</code> · {row.contractName}
                    </dd>
                  </div>
                ) : null,
              )}
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-[var(--ot-text-3)]">Simulation</dt>
                <dd className="m-0 text-right">Not run yet — arrives with swaps</dd>
              </div>
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-[var(--ot-text-3)]">Prepared by</dt>
                <dd className="m-0 text-right">{preparedBy(plan)}</dd>
              </div>
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-[var(--ot-text-3)]">Provenance</dt>
                <dd className="m-0 text-right">{plan.provenance === 'agent_crafted' ? 'Agent-crafted' : 'Built by Ottopus'}</dd>
              </div>
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-[var(--ot-text-3)]">Plan hash</dt>
                <dd className="m-0 text-right">
                  <code className="font-mono text-[11px] break-all">{plan.planHash.slice(0, 18)}…</code>
                </dd>
              </div>
            </dl>
            {decoded.map((row, i) => (
              <pre
                key={`raw${i}`}
                className="m-0 rounded-[8px] bg-[var(--ot-water-3)] px-[11px] py-2.5 font-mono text-[10.5px] leading-[1.6] break-all whitespace-pre-wrap text-[var(--ot-text-2)]"
              >
                {`to    ${row.raw.to}\nvalue ${row.raw.value}\ndata  ${row.raw.data}`}
              </pre>
            ))}
          </div>
        </details>
      </div>

      {grants.length > 0 || warnings.length > 0 ? (
        <div className="flex flex-col gap-2.5 px-[18px] pt-3.5">
          {grants.map((grant) => (
            <Callout
              key={grant.spender}
              severity={grant.unlimited ? 'block' : 'caution'}
              title={grant.unlimited ? 'This spender wants unlimited token access.' : 'This plan grants an approval.'}
              icon={<Otto pose="heads-up" size={44} />}
            >
              <span className="block">
                Spender <code className="font-mono text-[12px]">{grant.spender.split(':').pop()}</code>
                {spenderName(plan, grant.spender) ? ` · ${spenderName(plan, grant.spender)}` : ''}
              </span>
              <span className="block">
                Amount{' '}
                <code className="font-mono text-[12px] font-semibold">
                  {grant.unlimited ? 'unlimited' : approvalAmount(plan, grant.amount)}
                </code>
              </span>
            </Callout>
          ))}
          {warnings.map((w) => (
            <Callout key={w.code + w.message} severity={w.severity === 'block' ? 'block' : 'caution'} title={w.message}>
              {w.saferAlternative}
            </Callout>
          ))}
        </div>
      ) : null}

      <div className="h-3.5" />
      <footer className="flex flex-col gap-3 border-t border-[var(--ot-border)] bg-[var(--ot-water-1)] px-[18px] pt-3.5 pb-[18px]">
        {children}
        <p className="m-0 text-center text-[11px] leading-[1.5] text-[var(--ot-text-3)]">
          Ottopus never holds a key. Your wallet asks you to sign — it will never ask for a seed phrase.
        </p>
      </footer>
    </article>
  )
}

function approvalAmount(plan: Plan, amount: string): string {
  const asset = plan.intent.kind === 'transfer' ? assetWords(plan, plan.intent.asset) : null
  return asset ? `${formatAmount(amount, asset.decimals)} ${asset.symbol}` : amount
}

/** The 26px square at the head of a fact row: a logo when there is one, a glyph when not. */
function Tile({ mark, fallback, tone }: { mark: string | null; fallback: string; tone: string }) {
  return (
    <span
      aria-hidden
      className={cn('flex h-[26px] w-[26px] flex-none items-center justify-center overflow-hidden rounded-[8px] text-[12px] font-bold', tone)}
    >
      {mark ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={mark} alt="" className="h-full w-full object-cover" />
      ) : (
        fallback
      )}
    </span>
  )
}

/** The name the decoder found for a spender, when it is one of the plan's own targets. */
function spenderName(plan: Plan, spender: string): string | null {
  const hit = plan.decodedActions.find((a) => a.target.toLowerCase() === spender.toLowerCase())
  return hit?.contractName ?? null
}
