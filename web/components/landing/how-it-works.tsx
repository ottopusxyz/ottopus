'use client'

import { useEffect, useRef, useState } from 'react'
import { useMcpUrl } from '@/components/agents/use-mcp-url'
import { AssetIcon } from '@/components/portfolio/asset-icon'
import { WALLET_NAMES, walletMark } from '@/components/wallets/naming'
import { cn } from '@/lib/cn'

/**
 * Three steps, told as you scroll. On wide screens the steps run down the
 * left and one panel stays pinned on the right, redrawn for whichever step
 * is in the middle of the viewport. Below that there is no room to pin
 * anything, so each step carries its own panel inline.
 */

const STEPS = [
  {
    n: '01',
    title: 'Link your wallets',
    body: 'Hardware, hot, or a Safe — and now an agent wallet your agent runs itself. Up to eight — Otto only has eight arms.',
  },
  {
    n: '02',
    title: 'Point your agent at Ottopus',
    body: 'Works with Claude, Codex, or whatever you already talk to. One URL, nothing to install.',
  },
  {
    n: '03',
    title: 'Say what you want',
    body: 'Name the stock, not the token. Otto finds the right one, the wallet that can pay for it and the route, then hands back one link that explains itself.',
  },
] as const

export function HowItWorks() {
  const [active, setActive] = useState(0)
  const refs = useRef<(HTMLLIElement | null)[]>([])

  useEffect(() => {
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) setActive(Number((entry.target as HTMLElement).dataset.step))
        }
      },
      // A thin band across the middle of the viewport: the step crossing it is the one being read.
      { rootMargin: '-45% 0px -45% 0px' },
    )
    for (const el of refs.current) if (el) io.observe(el)
    return () => io.disconnect()
  }, [])

  return (
    <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,460px)] lg:gap-16">
      <ol className="m-0 flex list-none flex-col gap-12 p-0 lg:gap-0">
        {STEPS.map((step, i) => (
          <li
            key={step.n}
            ref={(el) => {
              refs.current[i] = el
            }}
            data-step={i}
            data-active={active === i}
            className="ot-story-step flex flex-col gap-4 lg:min-h-[62vh] lg:justify-center"
          >
            <span className="font-mono text-[13px] text-[var(--ot-coral-text)]">{step.n}</span>
            <h3 className="font-display m-0 text-[26px] leading-[1.15] font-bold tracking-[-0.02em] sm:text-[32px]">
              {step.title}
            </h3>
            <p className="m-0 max-w-[46ch] text-[16px] leading-[1.6] text-pretty text-[var(--ot-text-2)] sm:text-[17px]">
              {step.body}
            </p>
            <div className="lg:hidden">
              <Panel step={i} />
            </div>
          </li>
        ))}
      </ol>

      {/* The pinned column. Each panel is stacked in one grid cell so the
          swap is a crossfade, not a reflow. */}
      <div className="hidden lg:block">
        <div className="sticky top-[calc(50vh-190px)] grid">
          {STEPS.map((step, i) => (
            <div
              key={step.n}
              aria-hidden={active !== i}
              data-active={active === i}
              className="ot-story-panel col-start-1 row-start-1"
            >
              <Panel step={i} />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function Panel({ step }: { step: number }) {
  return (
    <div className="rounded-[var(--ot-radius-lg)] border border-[var(--ot-border)] bg-[var(--ot-card)] p-5 shadow-[var(--ot-shadow-card)] sm:p-6">
      {step === 0 ? <WalletsPanel /> : step === 1 ? <AgentPanel /> : <SayPanel />}
    </div>
  )
}

const ARMS = ['metamask', 'binance_wallet', 'ledger', 'safe', 'rabby_wallet'] as const

function WalletsPanel() {
  return (
    <div className="flex flex-col gap-4">
      <PanelTitle>Your arms</PanelTitle>
      <ul className="m-0 grid list-none grid-cols-2 gap-2 p-0">
        {ARMS.map((type) => (
          <li key={type} className="flex items-center gap-2 rounded-[12px] border border-[var(--ot-border)] px-3 py-2.5 text-[13px] font-medium">
            <AssetIcon url={walletMark(type)} name={WALLET_NAMES[type] ?? type} size={22} />
            <span className="truncate">{WALLET_NAMES[type]}</span>
            <span className="ml-auto text-[11px] text-[var(--ot-text-4)]">you sign</span>
          </li>
        ))}
        <li className="flex items-center gap-2 rounded-[12px] border border-[var(--ot-plan-border)] bg-[var(--ot-plan-bg)] px-3 py-2.5 text-[13px] font-medium">
          <AssetIcon url="/agents/other.svg" name="Agent wallet" size={22} />
          <span className="truncate text-[var(--ot-plan-text)]">Agent wallet</span>
          <span className="ml-auto text-[11px] text-[var(--ot-plan-text)]">agent sends</span>
        </li>
        {[0, 1].map((k) => (
          <li key={k} className="flex items-center justify-center rounded-[12px] border border-dashed border-[var(--ot-border-strong)] px-3 py-2.5 text-[13px] text-[var(--ot-text-4)]">
            + free arm
          </li>
        ))}
      </ul>
      <p className="m-0 text-[12px] text-[var(--ot-text-3)]">Each one proved with a signature. No keys, no seed phrases.</p>
    </div>
  )
}

const AGENTS = [
  { icon: 'claude-ai', name: 'Claude' },
  { icon: 'codex', name: 'Codex' },
  { icon: 'vscode', name: 'VS Code' },
  { icon: 'hermes', name: 'Hermes' },
] as const

function AgentPanel() {
  const mcp = useMcpUrl()
  const [copied, setCopied] = useState(false)
  const url = mcp.status === 'ready' ? mcp.url : 'https://…/mcp'

  const copy = () => {
    if (mcp.status !== 'ready') return
    void navigator.clipboard?.writeText(mcp.url).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    })
  }

  return (
    <div className="flex flex-col gap-4">
      <PanelTitle>Add a connector</PanelTitle>
      <div className="flex items-center gap-2 rounded-[12px] bg-[var(--ot-navy)] py-2 pr-2 pl-3.5">
        <code className="min-w-0 flex-1 truncate font-mono text-[13px] text-[var(--ot-cream)]">{url}</code>
        <button
          type="button"
          onClick={copy}
          disabled={mcp.status !== 'ready'}
          className="shrink-0 cursor-pointer rounded-[8px] bg-[rgba(255,240,220,0.12)] px-2.5 py-1.5 text-[12px] font-medium text-[var(--ot-cream)] transition-colors hover:bg-[rgba(255,240,220,0.2)] disabled:cursor-default disabled:opacity-60"
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
        {AGENTS.map((a) => (
          <li key={a.icon} className="flex items-center gap-2 rounded-[var(--ot-radius-pill)] border border-[var(--ot-border)] py-1 pr-3 pl-1 text-[13px]">
            <span className="flex h-6 w-6 items-center justify-center overflow-hidden rounded-full bg-[var(--ot-cream)]">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`/agents/${a.icon}.svg`} alt="" width={16} height={16} />
            </span>
            {a.name}
          </li>
        ))}
      </ul>
      <p className="m-0 text-[12px] text-[var(--ot-text-3)]">
        Remote MCP with OAuth. Your agent can prepare plans; it can never sign for a wallet you sign with.
      </p>
    </div>
  )
}

function SayPanel() {
  return (
    <div className="flex flex-col gap-3">
      <PanelTitle>In your agent</PanelTitle>
      <Bubble me>Buy $100 of Tesla on BNB Chain</Bubble>
      <Bubble>
        Ready: TSLAB from your Binance Wallet, routed and simulated. The market is closed, so it is
        priced against Friday&rsquo;s close. Review and sign:
        <span className="mt-2 flex items-center gap-2 rounded-[10px] border border-[var(--ot-plan-border)] bg-[var(--ot-plan-bg)] px-2.5 py-1.5 font-mono text-[12px] text-[var(--ot-plan-text)]">
          ottopus.xyz/review/7Kq…
        </span>
      </Bubble>
    </div>
  )
}

function Bubble({ me = false, children }: { me?: boolean; children: React.ReactNode }) {
  return (
    <p
      className={cn(
        'm-0 max-w-[88%] px-3.5 py-2.5 text-[14px] leading-[1.5]',
        me
          ? 'self-end rounded-[16px] rounded-br-[4px] bg-[var(--ot-coral-soft)] font-medium text-[var(--ot-coral-text)]'
          : 'self-start rounded-[16px] rounded-bl-[4px] bg-[var(--ot-surface-2)] text-[var(--ot-text)]',
      )}
    >
      {children}
    </p>
  )
}

function PanelTitle({ children }: { children: React.ReactNode }) {
  return <p className="m-0 text-[11px] font-semibold tracking-[0.06em] text-[var(--ot-text-3)] uppercase">{children}</p>
}
