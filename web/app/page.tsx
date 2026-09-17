import Link from 'next/link'
import { Lockup, Otto } from '@/components/brand'
import { BubbleField } from '@/components/motion'
import { ThemeToggle } from '@/components/theme-toggle'
import { Badge, Card, buttonClasses } from '@/components/ui'

/**
 * The landing page. Copy is settled — see #6 — and used verbatim.
 *
 * This is the only page in the product where the water is loud, and even here
 * it stays in the gutters: the canvas gradient, one caustic wash and three
 * bubbles sit behind the hero's padding, never behind the headline. It has to
 * read as ocean with motion off, so depth and caustics carry it and the bubbles
 * are the garnish.
 *
 * Outside the app shell on purpose. A visitor here is not signed in, so there
 * is no nav — just the lockup, the theme control, and one primary button.
 */

const STEPS = [
  {
    n: '01',
    title: 'Link your wallets',
    body: 'Hardware, hot, or a Safe. Up to eight — Otto only has eight arms.',
  },
  {
    n: '02',
    title: 'Point your agent at Ottopus',
    body: 'Works with Claude, Codex, or whatever you already talk to. Nothing to install.',
  },
  {
    n: '03',
    title: 'Say what you want',
    body: '“Swap 500 USDC for ETH.” You get back plain language describing exactly what will happen, and you sign it in your own wallet, like always.',
  },
]

export default function Landing() {
  return (
    <div className="flex min-h-dvh flex-col">
      {/* The brand bar, as the app design draws it: navy ground, cream lockup,
          a cream hairline underneath. Navy and cream are the two tokens that do
          not move between themes, so this bar looks identical in both. */}
      <header
        className={
          'sticky top-0 z-50 flex items-center justify-between gap-4 ' +
          'border-b border-[rgba(255,240,220,0.14)] bg-[var(--ot-navy)] px-5 py-[14px] sm:px-8'
        }
      >
        <Lockup layout="horizontal" tone="reversed" size={30} />
        <ThemeToggle tone="reversed" />
      </header>

      <main className="flex flex-1 flex-col">
        {/* Hero. The canvas gradient and the bubbles live on this section only. */}
        <section className="ot-canvas relative overflow-hidden px-5 py-14 sm:px-10 sm:py-20">
          <div className="ot-caustic" />
          <BubbleField pattern="canvas" />

          <div className="relative mx-auto grid w-full max-w-[1100px] items-center gap-10 lg:grid-cols-[minmax(0,1fr)_280px]">
            <div className="flex flex-col gap-5">
              <Badge tone="plan" className="w-fit">
                Transaction review for AI agents
              </Badge>

              <h1 className="font-display max-w-[20ch] text-[38px] leading-[1.05] font-bold tracking-[-0.025em] text-pretty sm:text-[52px]">
                Stop juggling wallets to get one thing done
              </h1>

              <p className="max-w-[54ch] text-[17px] leading-[1.55] text-pretty text-[var(--ot-text-2)] sm:text-[18px]">
                Tell your agent what you want, not where to find it. Ottopus works out which
                wallet, which chain and which app — then shows you exactly what will happen before
                anything moves.
              </p>

              <div className="flex flex-wrap items-center gap-2">
                <Link href="/portfolio" className={buttonClasses({ variant: 'primary', size: 'lg' })}>
                  Link your first wallet
                </Link>
                <Link href="/review/demo" className={buttonClasses({ variant: 'ghost', size: 'lg' })}>
                  See what a review looks like
                </Link>
              </div>

              <p className="text-[13px] text-[var(--ot-text-3)]">
                Ottopus never holds a key and never asks for a seed phrase.
              </p>
            </div>

            {/* Below lg he follows the pitch rather than leading it: 280px of
                octopus before the headline buries what the product is. */}
            <div className="ot-drift mx-auto lg:mx-0">
              <Otto
                pose="plan-ready"
                size={280}
                animated
                className="h-auto w-[200px] max-w-full sm:w-[240px] lg:w-[280px]"
              />
            </div>
          </div>
        </section>

        {/* Everything below carries copy, so the water stops here. */}
        <section className="border-t border-[var(--ot-border)] px-5 py-9 sm:px-10">
          <div className="mx-auto flex w-full max-w-[1100px] flex-col gap-4">
            <h2 className="font-display text-[24px] leading-[1.2] font-bold tracking-[-0.02em] sm:text-[28px]">
              One conversation instead of six tabs
            </h2>
            <p className="max-w-[74ch] text-[16px] leading-[1.6] text-pretty text-[var(--ot-text-3)]">
              <span className="font-semibold text-[var(--ot-text-2)]">Today:</span> work out which
              wallet has the funds, bridge to the right chain, find the right app, approve, swap,
              hope you read it right.
            </p>
            <p className="max-w-[74ch] text-[16px] leading-[1.6] text-pretty text-[var(--ot-text)]">
              <span className="font-semibold">With Ottopus:</span> say it once. Otto picks the
              wallet and tells you why, builds the route, and hands you one link that explains
              itself.
            </p>
          </div>
        </section>

        <section className="px-5 pb-9 sm:px-10">
          <Card className="mx-auto w-full max-w-[1100px] overflow-hidden">
            <ol className="grid sm:grid-cols-3">
              {STEPS.map((step, i) => (
                <li
                  key={step.n}
                  className={
                    'flex flex-col gap-[7px] p-7' +
                    (i > 0 ? ' border-t border-[var(--ot-border)] sm:border-t-0 sm:border-l' : '')
                  }
                >
                  <span className="font-mono text-[12px] text-[var(--ot-text-3)]">{step.n}</span>
                  <span className="font-display text-[19px] font-bold">{step.title}</span>
                  <span className="text-[14px] leading-[1.5] text-pretty text-[var(--ot-text-2)]">
                    {step.body}
                  </span>
                </li>
              ))}
            </ol>
          </Card>
        </section>
      </main>

      <footer className="flex flex-col items-center gap-4 border-t border-[var(--ot-border)] px-5 py-8 sm:px-10">
        <p className="font-display text-center text-[18px] font-semibold tracking-[-0.01em] text-[var(--ot-text-2)] sm:text-[20px]">
          One intent. Every wallet. You still sign.
        </p>
        <Lockup layout="horizontal" size={26} />
      </footer>
    </div>
  )
}
