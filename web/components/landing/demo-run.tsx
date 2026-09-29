'use client'

import { useEffect, useState } from 'react'
import { Otto, type PoseName } from '@/components/brand'
import { AgentIcon } from '@/components/agents/agent-icon'
import { AssetIcon } from '@/components/portfolio/asset-icon'
import { IssuerMark } from '@/components/ui'
import { walletMark } from '@/components/wallets/naming'
import { cn } from '@/lib/cn'
import { useMediaQuery } from '@/lib/use-media-query'

/**
 * The hero's right half: one request, run end to end, so a first-time visitor
 * sees the whole product before reading a word of it. The prompt is typed, then
 * each thing Ottopus does lands as a line, and Otto's pose follows along.
 *
 * Illustrative, and the card says so. The figures are the shape a real run
 * returns, not a quote: a landing page must never look like a live price.
 *
 * Two runs. The first is the one the whole product leads with, a stock on BNB
 * Chain out of a wallet you sign with. The second is an agent's own wallet,
 * where a rule you set approves it after the simulation passes.
 *
 * The server renders the first run finished, so the card is never blank. With
 * reduced motion it stays that way.
 */

type StepKind = 'find' | 'wallet' | 'rule' | 'simulate'

interface Step {
  kind: StepKind
  /** The tool or the stage, in the mono voice the agent sees. */
  tool: string
  title: string
  detail?: string
  /** The issuers' tokens for the stock, when the step is a find. */
  issuers?: readonly { issuer: string; symbol: string; premium: string; best?: boolean }[]
  wallet?: string
}

export interface DemoRun {
  prompt: string
  steps: readonly Step[]
  done: string
  signer: 'you' | 'agent'
}

export const DEMO_RUNS: readonly DemoRun[] = [
  {
    prompt: 'Buy NVIDIA with 50 USDT on BNB Chain',
    steps: [
      {
        kind: 'find',
        tool: 'find_stock',
        title: 'NVIDIA, from three issuers',
        issuers: [
          { issuer: 'ondo', symbol: 'NVDAon', premium: '+0.03%', best: true },
          { issuer: 'bstock', symbol: 'NVDAB', premium: '+0.08%' },
          { issuer: 'xstocks', symbol: 'NVDAx', premium: '+0.21%' },
        ],
      },
      { kind: 'wallet', tool: 'pick wallet', title: 'Rabby pays', detail: 'Holds USDT on BNB Chain. No bridge needed.', wallet: 'rabby_wallet' },
      { kind: 'simulate', tool: 'simulate', title: 'Simulated', detail: '−50 USDT  ·  +NVDAon ≈ $49.9' },
    ],
    done: 'Review link ready. You sign in Rabby.',
    signer: 'you',
  },
  {
    prompt: 'Buy $100 of Tesla with my agent wallet',
    steps: [
      {
        kind: 'find',
        tool: 'find_stock',
        title: 'Tesla, market open',
        issuers: [{ issuer: 'ondo', symbol: 'TSLAon', premium: '+0.05%', best: true }],
      },
      { kind: 'rule', tool: 'your rule', title: 'Within your rule', detail: 'Stocks only, up to $250 a day.' },
      { kind: 'simulate', tool: 'simulate', title: 'Simulated', detail: '−100 USDT  ·  +TSLAon ≈ $99.8' },
    ],
    done: 'Approved by your rule. The agent’s wallet sends it.',
    signer: 'agent',
  },
]

/** Otto's drawing for each point in a run: typing, each step, and done. */
function poseFor(run: DemoRun, shown: number, typing: boolean): PoseName {
  if (typing) return 'tapping'
  if (shown > run.steps.length) return 'plan-ready'
  const step = run.steps[Math.max(0, shown - 1)]
  return step?.kind === 'simulate' ? 'simulating' : 'planning'
}

const TYPE_MS = 38
const STEP_MS = 1100
const HOLD_MS = 3800
const REST_MS = 500

export function DemoRunCard({ className }: { className?: string }) {
  const still = useMediaQuery('(prefers-reduced-motion: reduce)')
  const [runIndex, setRunIndex] = useState(0)
  const [typed, setTyped] = useState(DEMO_RUNS[0]!.prompt.length)
  // Steps shown, and one more than the steps for the closing line.
  const [shown, setShown] = useState(DEMO_RUNS[0]!.steps.length + 1)

  useEffect(() => {
    if (still) return
    let run = 0
    let timer: ReturnType<typeof setTimeout>

    const start = () => {
      setRunIndex(run)
      setShown(0)
      setTyped(0)
      type(0)
    }
    const type = (n: number) => {
      const prompt = DEMO_RUNS[run]!.prompt
      if (n > prompt.length) {
        timer = setTimeout(() => step(1), REST_MS)
        return
      }
      setTyped(n)
      timer = setTimeout(() => type(n + 1), TYPE_MS)
    }
    const step = (n: number) => {
      const total = DEMO_RUNS[run]!.steps.length + 1
      setShown(n)
      if (n < total) {
        timer = setTimeout(() => step(n + 1), STEP_MS)
        return
      }
      timer = setTimeout(() => {
        run = (run + 1) % DEMO_RUNS.length
        start()
      }, HOLD_MS)
    }

    // The first run is already finished from the server render; hold it, then
    // move on to the next rather than retyping what is on screen.
    timer = setTimeout(() => {
      run = 1
      start()
    }, HOLD_MS)
    return () => clearTimeout(timer)
  }, [still])

  const run = DEMO_RUNS[runIndex]!
  const typing = typed < run.prompt.length
  const pose = poseFor(run, shown, typing)

  return (
    <div className={cn('relative', className)}>
      {/* Otto sits on the card's top edge, working the run. */}
      <div aria-hidden className="ot-drift absolute -top-[74px] right-4 z-10 sm:-top-[88px] sm:right-6">
        <Otto pose={pose} size={120} animated className="h-auto w-[96px] sm:w-[116px]" />
      </div>

      <div className="ot-demo-card relative overflow-hidden rounded-[var(--ot-radius-lg)] border border-[var(--ot-border)] bg-[color-mix(in_srgb,var(--ot-card)_92%,transparent)] shadow-[0_1px_2px_rgba(22,33,62,.06),0_24px_60px_-20px_rgba(22,33,62,.28)] backdrop-blur-md">
        <p className="sr-only">
          An illustrative run. You ask your agent to buy NVIDIA with 50 USDT on BNB Chain. Ottopus
          compares NVIDIA’s token from every issuer, picks the wallet that holds USDT on BNB Chain,
          simulates the trade and hands back a review link you sign in your own wallet. With an agent
          wallet, a rule you set approves it after the simulation passes.
        </p>

        <div aria-hidden>
          {/* The agent's window chrome. */}
          <div className="flex items-center gap-2.5 border-b border-[var(--ot-border)] px-4 py-3">
            <AgentIcon name="Claude" iconKey="claude-ai" size={22} className="rounded-[6px]" />
            <span className="text-[13px] font-semibold">Your agent</span>
            <span className="font-mono text-[11px] text-[var(--ot-text-3)]">+ ottopus</span>
            <span className="ml-auto rounded-full bg-[var(--ot-surface-3)] px-2 py-0.5 text-[10px] font-semibold tracking-[0.06em] text-[var(--ot-text-3)] uppercase">
              Illustrative
            </span>
          </div>

          <div className="flex min-h-[452px] flex-col gap-3 p-4 sm:min-h-[420px]">
            {/* What you said. */}
            <div className="ml-auto max-w-[88%] rounded-[16px] rounded-br-[6px] bg-[var(--ot-navy)] px-3.5 py-2.5 font-mono text-[13px] leading-[1.45] text-[var(--ot-cream)] ring-1 ring-[rgba(255,240,220,0.14)]">
              {run.prompt.slice(0, typed)}
              {typing ? <span className="ml-px inline-block h-[1em] w-[2px] translate-y-[0.15em] bg-[var(--ot-coral)]" /> : null}
            </div>

            <ol className="m-0 flex list-none flex-col gap-2 p-0">
              {run.steps.map((step, i) =>
                i < shown ? (
                  <li key={`${runIndex}-${i}`} className="ot-demo-step">
                    <StepLine step={step} />
                  </li>
                ) : i === shown && !typing ? (
                  <li key={`${runIndex}-${i}-pending`} className="flex items-center gap-2 px-1 text-[12px] text-[var(--ot-text-3)]">
                    <span className="inline-flex gap-1">
                      {[0, 1, 2].map((d) => (
                        <span key={d} className="ot-dot h-[5px] w-[5px] rounded-full bg-[var(--ot-plan)]" style={{ animationDelay: `${d * 0.2}s` }} />
                      ))}
                    </span>
                    <span className="font-mono">{step.tool}</span>
                  </li>
                ) : null,
              )}
            </ol>

            {shown > run.steps.length ? (
              <div key={`${runIndex}-done`} className="ot-demo-step mt-auto flex items-center gap-2.5 rounded-[12px] border border-[var(--ot-ok-border)] bg-[var(--ot-ok-bg)] px-3 py-2.5 text-[13px] font-medium text-[var(--ot-ok-text)]">
                <Tick />
                <span className="min-w-0 flex-1">{run.done}</span>
                <span className="rounded-full bg-[var(--ot-card)] px-2 py-0.5 text-[11px] font-semibold text-[var(--ot-text)]">
                  {run.signer === 'you' ? 'You sign' : 'Agent sends'}
                </span>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  )
}

function StepLine({ step }: { step: Step }) {
  return (
    <div className="rounded-[12px] border border-[var(--ot-border)] bg-[var(--ot-surface)] px-3 py-2.5">
      <div className="flex items-center gap-2">
        <StepGlyph kind={step.kind} />
        <span className="text-[13px] font-semibold">{step.title}</span>
        <span className="ml-auto font-mono text-[10.5px] text-[var(--ot-text-3)]">{step.tool}</span>
      </div>

      {step.issuers ? (
        <ul className="m-0 mt-2 flex list-none flex-col gap-1 p-0">
          {step.issuers.map((row) => (
            <li
              key={row.symbol}
              className={cn(
                'flex items-center gap-2 rounded-[8px] px-2 py-1 text-[12px]',
                row.best ? 'bg-[var(--ot-plan-bg)] text-[var(--ot-plan-text)]' : 'text-[var(--ot-text-2)]',
              )}
            >
              <span className="font-mono font-semibold">{row.symbol}</span>
              <IssuerMark issuer={row.issuer} ticker={row.symbol} />
              <span className="ml-auto font-mono tabular-nums">{row.premium}</span>
              {row.best ? <span className="text-[10px] font-semibold tracking-[0.04em] uppercase">best</span> : null}
            </li>
          ))}
        </ul>
      ) : null}

      {step.detail ? (
        <p className="m-0 mt-1 flex items-center gap-1.5 pl-6 text-[12px] whitespace-pre text-[var(--ot-text-2)]">
          {step.wallet ? <AssetIcon url={walletMark(step.wallet)} name="" size={14} /> : null}
          {step.detail}
        </p>
      ) : null}
    </div>
  )
}

const GLYPHS: Record<StepKind, string> = {
  find: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4',
  wallet: 'M3 7.5A2.5 2.5 0 0 1 5.5 5h12A2.5 2.5 0 0 1 20 7.5v9a2.5 2.5 0 0 1-2.5 2.5h-12A2.5 2.5 0 0 1 3 16.5zM3 10h17M15 13.5h2',
  rule: 'M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6zM9 12l2 2 4-4',
  simulate: 'M12 3l8 4.5v9L12 21l-8-4.5v-9zM12 12l8-4.5M12 12v9M12 12L4 7.5',
}

function StepGlyph({ kind }: { kind: StepKind }) {
  return (
    <span className="inline-flex h-[18px] w-[18px] flex-none items-center justify-center rounded-full bg-[var(--ot-plan-bg)] text-[var(--ot-plan-text)]">
      <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
        <path d={GLYPHS[kind]} />
      </svg>
    </span>
  )
}

function Tick() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4 flex-none" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 12.5l4.5 4.5L19 7" />
    </svg>
  )
}
