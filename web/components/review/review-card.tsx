'use client'

import type { ReactNode } from 'react'
import { Otto } from '@/components/brand'
import { AssetIcon } from '@/components/portfolio/asset-icon'
import { Callout } from '@/components/ui'
import { walletClientName, walletMark } from '@/components/wallets/naming'
import type { Plan, Visuals } from '@/lib/api'
import { chainName } from '@/lib/chains'
import { cn } from '@/lib/cn'
import { addressOf, formatAmount, truncateAddress } from '@/lib/format'
import {
  SOURCE_LABEL,
  approvals,
  assetChanges,
  assetWords,
  bannerWarnings,
  chainOfPlan,
  changeSource,
  executability,
  keyFacts,
  recipientOf,
} from './model'
import type { LiveSimulation } from './use-simulation'

/**
 * P4's card, cut to the decision.
 *
 * A review link is usually opened on a phone, from a chat, to answer one
 * question: is this the right amount going to the right person, and do I want
 * it. Everything that answers that is here and fits on a screen with the
 * button that acts on it — the outcome of signing included, which is the
 * point of keeping the card short. Everything that answers "what exactly does
 * this calldata do" is in the advanced panel: beside the card on a wide
 * screen, one tap away on a phone.
 *
 * Rows were the thing to cut. The expiry moved into the header beside the
 * progress, the wallet and the network onto one line under the amount, and
 * the recipient onto the amount itself — "500 USDC to koshik.eth" is one fact
 * to a person and was three rows to the page.
 */
export interface ReviewCardProps {
  plan: Plan
  /** "request #9611cc" — the short id in the header. */
  reference: string
  /** The countdown, or a status word when there is nothing to count. */
  clock: ReactNode
  /** Icons and wallet clients, looked up beside the plan. Absent draws letters and tiles. */
  visuals?: Visuals | undefined
  /** The browser's own run, which replaces the stored one on the rows below. */
  live?: LiveSimulation | undefined
  /** The advanced panel, for a screen too narrow to put it beside the card. */
  advanced?: ReactNode
  children: ReactNode
}

const NO_VISUALS: Visuals = { assets: {}, chains: {}, wallets: {} }

export function ReviewCard({
  plan,
  reference,
  clock,
  visuals = NO_VISUALS,
  live,
  advanced,
  children,
}: ReviewCardProps) {
  const chain = chainOfPlan(plan)
  const chainVisual = visuals.chains[chain] ?? null
  const signer = visuals.wallets[plan.resolution.account.caip10] ?? null
  const signerClient = signer ? walletClientName({ label: signer.label, walletType: signer.walletType }) : null
  const signerMark = signer ? walletMark(signer.walletType) : null
  const signerName =
    signer?.label ?? signerClient ?? truncateAddress(addressOf(plan.resolution.account.caip10))
  const liveRun = live?.run ?? null
  const changes = assetChanges(plan, liveRun)
  const source = changeSource(plan, liveRun)
  const recipient = recipientOf(plan)
  const rows = keyFacts(plan)
  const grants = approvals(plan)
  const warnings = bannerWarnings(plan)
  const verdict = executability(plan, liveRun)

  return (
    <article className="flex flex-col overflow-hidden rounded-[26px] border border-[var(--ot-border-strong)] bg-[var(--ot-card)] shadow-[var(--ot-shadow-card)] sm:rounded-[16px] sm:border-[var(--ot-border)]">
      <header className="flex items-center justify-between gap-3 px-[18px] pt-4 pb-2.5">
        <span className="text-[15px] font-semibold">Review</span>
        <span className="flex items-center gap-2.5">
          <span className="font-mono text-[11.5px] text-[var(--ot-text-3)]">{reference}</span>
          <span className="font-mono text-[12.5px] font-semibold tabular-nums">{clock}</span>
        </span>
      </header>

      <div className="flex flex-col gap-[3px] px-[18px] pb-3.5">
        <h1 className="m-0 font-[family-name:var(--ot-font-display)] text-[20px] leading-[1.28] font-bold tracking-[-0.01em]">
          {plan.humanPlan.summary}
        </h1>
        <p className="m-0 text-[13px] leading-[1.45] text-[var(--ot-text-2)]">{plan.resolution.reason}</p>
      </div>

      {/* Amount, recipient and signer: one block, because to a person it is one thought. */}
      <section className="flex flex-col gap-2.5 bg-[var(--ot-water-1)] px-[18px] py-3.5">
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
                <span className="truncate text-[11.5px] text-[var(--ot-text-3)]">
                  {change.direction === 'out' && recipient
                    ? `to ${recipient.name ?? truncateAddress(recipient.address)}`
                    : change.where}
                </span>
              </div>
            </div>
          ))}
          {changes.length === 0 ? (
            <p className="m-0 text-[13px] text-[var(--ot-text-2)]">{plan.humanPlan.steps[0] ?? plan.humanPlan.summary}</p>
          ) : null}
        </div>

        {/*
          Whether it runs, who signs, where, and how fresh the reading is.
          The verdict is a mark and two words: a person deciding needs to know
          that something is wrong, not what — the reason is in Advanced review.
        */}
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-[var(--ot-text-2)]">
          <span className="flex items-center gap-1.5">
            <Tile mark={signerMark} fallback="◈" tone="bg-[var(--ot-navy-soft)] text-[var(--ot-text)]" />
            <span className="font-semibold">{signerName}</span>
          </span>
          <Dot />
          {/*
            The verdict sits with the network, not on its own: whether these
            calls execute is a fact about this chain at this block, and
            reading them apart invites "executable" to be heard as a property
            of the plan itself.
          */}
          <span className="flex items-center gap-1.5">
            <Tile
              mark={chainVisual?.iconUrl ?? null}
              fallback={chainName(chain).slice(0, 1)}
              tone="bg-[var(--ot-surface-3)] text-[var(--ot-text-2)]"
            />
            <span>{chainName(chain)}</span>
            {verdict ? (
              <span
                className={cn(
                  'flex items-center gap-1 rounded-full px-2 py-[3px] text-[11px] font-semibold',
                  verdict.ok
                    ? 'bg-[var(--ot-ok-bg)] text-[var(--ot-ok-text)]'
                    : 'bg-[var(--ot-block-bg)] text-[var(--ot-block-text)]',
                )}
              >
                <span aria-hidden>{verdict.ok ? '✓' : '✕'}</span>
                {verdict.label}
              </span>
            ) : null}
          </span>
          <Dot />
          <span className="text-[var(--ot-text-3)]">
            {live?.kind === 'running' ? 'checking against the chain…' : SOURCE_LABEL[source]}
          </span>
        </div>
      </section>

      <div className="flex flex-col px-[18px]">
        {rows.map((fact) => (
          <div
            key={fact.label}
            className="flex items-center justify-between gap-3 border-b border-[var(--ot-border)] py-[11px]"
          >
            <span className="text-[13.5px] text-[var(--ot-text-2)]">{fact.label}</span>
            <span className="flex min-w-0 flex-col items-end gap-px text-right">
              <span className={cn('text-[13.5px] font-semibold', fact.mono && 'font-mono tabular-nums')}>
                {fact.value}
              </span>
              {fact.detail ? <span className="text-[11.5px] text-[var(--ot-text-3)]">{fact.detail}</span> : null}
            </span>
          </div>
        ))}
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

      <footer className="mt-3.5 flex flex-col gap-3 border-t border-[var(--ot-border)] bg-[var(--ot-water-1)] px-[18px] pt-3.5 pb-[18px]">
        {children}
        <p className="m-0 text-center text-[11px] leading-[1.5] text-[var(--ot-text-3)]">
          Ottopus never holds a key. Your wallet asks you to sign — it will never ask for a seed phrase.
        </p>
      </footer>

      {/* Below the width that fits a panel beside the card, it goes under it. */}
      {advanced ? <div className="min-[1032px]:hidden">{advanced}</div> : null}
    </article>
  )
}

const Dot = () => (
  <span aria-hidden className="text-[var(--ot-text-3)]">
    ·
  </span>
)

function approvalAmount(plan: Plan, amount: string): string {
  const asset = plan.intent.kind === 'transfer' ? assetWords(plan, plan.intent.asset) : null
  return asset ? `${formatAmount(amount, asset.decimals)} ${asset.symbol}` : amount
}

/** A 22px mark: the wallet's logo, the chain's icon, or a letter. */
function Tile({ mark, fallback, tone }: { mark: string | null; fallback: string; tone: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        'flex h-[22px] w-[22px] flex-none items-center justify-center overflow-hidden rounded-[7px] text-[10px] font-bold',
        tone,
      )}
    >
      {mark ? (
        // Bundled wallet marks and provider CDN chain icons, as elsewhere.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={mark} alt="" className="h-full w-full object-contain" />
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
