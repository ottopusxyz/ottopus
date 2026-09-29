'use client'

import { useEffect, useState } from 'react'
import { Otto } from '@/components/brand'
import { AssetIcon } from '@/components/portfolio/asset-icon'
import { IssuerMark } from '@/components/ui'
import { walletMark } from '@/components/wallets/naming'
import { cn } from '@/lib/cn'
import { useMediaQuery } from '@/lib/use-media-query'
import { BEATS, BEAT_MS, HERO_RUNS, poseFor, type Beat, type HeroRun } from './hero-script'

/**
 * The hero's right half: a conversation with an agent, and Ottopus working
 * it into a plan, beat by beat, with Otto perched on the card doing each part.
 *
 * Every beat is always laid out and the ones not reached yet are only hidden,
 * so the card never changes height while it plays and nothing below it moves.
 * The server draws the first run complete, which is also what a visitor with
 * reduced motion keeps; the loop starts by holding that, then replaying.
 */
export function HeroDemo({ className }: { className?: string }) {
  const still = useMediaQuery('(prefers-reduced-motion: reduce)')
  const [run, setRun] = useState(0)
  const [shown, setShown] = useState(BEATS.length)

  useEffect(() => {
    if (still) return
    let r = 0
    let n = BEATS.length
    let timer: ReturnType<typeof setTimeout>
    const next = () => {
      if (n === BEATS.length) {
        r = (r + 1) % HERO_RUNS.length
        n = 1
        setRun(r)
      } else {
        n++
      }
      setShown(n)
      timer = setTimeout(next, BEAT_MS[BEATS[n - 1]!])
    }
    timer = setTimeout(next, BEAT_MS.review)
    return () => clearTimeout(timer)
  }, [still])

  const current = HERO_RUNS[still ? 0 : run]!
  const visible = still ? BEATS.length : shown
  const newest = BEATS[visible - 1]!
  const on = (beat: Beat) => BEATS.indexOf(beat) < visible

  return (
    <div className={cn('relative', className)}>
      <p className="sr-only">
        For example, you tell your agent “{HERO_RUNS[0]!.prompt}”. Ottopus compares the NVIDIA stock
        tokens, picks the wallet that holds the funds, routes and simulates the trade, and hands back
        a review link for you to sign.
      </p>

      {/* Otto sits on the card's top edge and does whatever the newest beat is. */}
      <div aria-hidden className="pointer-events-none absolute -top-[74px] right-5 z-10 sm:right-8">
        <div className="ot-drift">
          <Otto pose={poseFor(current, newest)} size={96} animated className="h-auto w-[84px] sm:w-[96px]" />
        </div>
      </div>

      <div
        aria-hidden
        className={
          'ot-land-card relative overflow-hidden rounded-[var(--ot-radius-lg)] border border-[var(--ot-border)] ' +
          'bg-[color-mix(in_srgb,var(--ot-card)_92%,transparent)] shadow-[0_2px_4px_rgba(22,33,62,.05),0_24px_60px_-12px_rgba(22,33,62,.22)] backdrop-blur-md'
        }
      >
        <div className="flex items-center gap-2 border-b border-[var(--ot-border)] px-4 py-3">
          <span className="flex gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-[var(--ot-surface-3)]" />
            <span className="h-2.5 w-2.5 rounded-full bg-[var(--ot-surface-3)]" />
            <span className="h-2.5 w-2.5 rounded-full bg-[var(--ot-surface-3)]" />
          </span>
          <span className="ml-1 text-[12px] font-semibold text-[var(--ot-text-2)]">Your agent</span>
          <span className="text-[12px] text-[var(--ot-text-4)]">· Ottopus connected</span>
        </div>

        <div className="flex flex-col gap-3 p-4 sm:p-5">
          <Step on={on('prompt')} className="flex justify-end">
            <span className="max-w-[85%] rounded-[16px] rounded-br-[4px] bg-[var(--ot-coral-soft)] px-3.5 py-2 text-[14px] font-medium text-[var(--ot-coral-text)]">
              {current.prompt}
            </span>
          </Step>

          <Step on={on('stock')}>
            <Label tool="find_stock">NVIDIA on BNB Chain</Label>
            <ul className="m-0 mt-1.5 flex list-none flex-col gap-1 p-0">
              {current.stocks.map((s) => (
                <li
                  key={s.symbol}
                  className={cn(
                    'flex items-center gap-2 rounded-[10px] px-2.5 py-1.5 text-[13px]',
                    s.picked ? 'bg-[var(--ot-plan-bg)] ring-1 ring-[var(--ot-plan-border)]' : '',
                  )}
                >
                  <span className="font-mono font-semibold text-[var(--ot-text)]">{s.symbol}</span>
                  <IssuerMark issuer={s.issuer} ticker="NVDA" />
                  <span className="ml-auto font-mono text-[12px] tabular-nums text-[var(--ot-text-2)]">
                    {s.premium === null ? 'no market data' : `+${s.premium.toFixed(2)}% vs ref`}
                  </span>
                  {s.picked ? <span className="text-[11px] font-semibold text-[var(--ot-plan-text)]">picked</span> : null}
                </li>
              ))}
            </ul>
          </Step>

          <Step on={on('wallet')}>
            <Label>Wallet</Label>
            <p className="m-0 mt-1.5 flex items-center gap-2 text-[13px] text-[var(--ot-text-2)]">
              <WalletIcon run={current} />
              <span className="font-semibold text-[var(--ot-text)]">{current.wallet.name}</span>
              <span className="truncate">— {current.wallet.reason}</span>
            </p>
          </Step>

          <Step on={on('checks')}>
            <Label>Checks</Label>
            <p className="m-0 mt-1.5 flex flex-wrap gap-1.5">
              <Check>Route found</Check>
              <Check>Simulated independently</Check>
              <Check>Market open</Check>
            </p>
          </Step>

          <Step on={on('review')}>
            <div className="rounded-[var(--ot-radius-md)] border border-[var(--ot-border)] bg-[var(--ot-surface-2)] p-3">
              <div className="flex items-center justify-between gap-3 text-[13px]">
                <span className="text-[var(--ot-text-3)]">You pay</span>
                <span className="font-mono font-semibold tabular-nums">{current.pay}</span>
              </div>
              <div className="mt-1 flex items-center justify-between gap-3 text-[13px]">
                <span className="text-[var(--ot-text-3)]">You get</span>
                <span className="font-mono font-semibold tabular-nums">{current.get}</span>
              </div>
              {current.finish === 'sign' ? (
                <span className="mt-3 flex items-center justify-center gap-2 rounded-[var(--ot-radius-pill)] bg-[var(--ot-coral)] px-4 py-2.5 text-[14px] font-semibold text-[var(--ot-on-state)]">
                  Review and sign in {current.wallet.name}
                </span>
              ) : (
                <span className="mt-3 flex items-center justify-center gap-2 rounded-[var(--ot-radius-pill)] bg-[var(--ot-ok-bg)] px-4 py-2.5 text-[14px] font-semibold text-[var(--ot-ok-text)] ring-1 ring-[var(--ot-ok-border)]">
                  Approved by your rule · your agent sends it
                </span>
              )}
            </div>
          </Step>
        </div>
      </div>

      <p className="mt-2.5 text-center text-[11px] text-[var(--ot-text-4)]">Illustrative figures, not a quote.</p>
    </div>
  )
}

/** One beat. Laid out from the start; it only fades up when its turn comes. */
function Step({ on, className, children }: { on: boolean; className?: string; children: React.ReactNode }) {
  return (
    <div className={cn('ot-beat', className)} data-on={on}>
      {children}
    </div>
  )
}

function Label({ tool, children }: { tool?: string; children: React.ReactNode }) {
  return (
    <p className="m-0 flex items-center gap-2 text-[11px] font-semibold tracking-[0.06em] text-[var(--ot-text-3)] uppercase">
      {tool ? <span className="rounded-[6px] bg-[var(--ot-surface-3)] px-1.5 py-0.5 font-mono text-[11px] tracking-normal normal-case text-[var(--ot-text-2)]">{tool}</span> : null}
      {children}
    </p>
  )
}

function Check({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-[var(--ot-radius-pill)] bg-[var(--ot-ok-bg)] px-2.5 py-1 text-[12px] font-medium text-[var(--ot-ok-text)]">
      <svg viewBox="0 0 16 16" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
        <path d="M3.5 8.5l3 3 6-7" />
      </svg>
      {children}
    </span>
  )
}

function WalletIcon({ run }: { run: HeroRun }) {
  const url = run.wallet.type === 'agentic' ? '/agents/other.svg' : walletMark(run.wallet.type)
  return <AssetIcon url={url} name={run.wallet.name} size={20} />
}
