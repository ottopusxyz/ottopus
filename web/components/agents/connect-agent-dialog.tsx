'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Otto } from '@/components/brand'
import { Button, Dialog } from '@/components/ui'
import { MCP_URL, type AgentGrant } from '@/lib/api'
import { cn } from '@/lib/cn'
import { agentBrand } from './agent-brand'
import { AgentIcon } from './agent-icon'
import { CONNECT_CLIENTS, payloadFor } from './connect-clients'
import { useAgents } from './use-agents'

export interface ConnectAgentDialogProps {
  open: boolean
  onClose: () => void
}

/**
 * D3 · Connect agent.
 *
 * The design's shell — Otto, the headline, the client pills, and the live wait
 * for a handshake — with logr's payload: a single command where the client has
 * one, and the numbered steps only where it does not.
 *
 * The URL in the design is `/v1/sse`, which predates the transport decision.
 * This is Streamable HTTP, and the address comes from config rather than the
 * drawing so a deployment cannot hand out one nothing is listening on.
 */
export function ConnectAgentDialog({ open, onClose }: ConnectAgentDialogProps) {
  const [clientKey, setClientKey] = useState(CONNECT_CLIENTS[0]!.key)
  const client = CONNECT_CLIENTS.find((c) => c.key === clientKey) ?? CONNECT_CLIENTS[0]!
  const arrived = useAgentArrival(open)

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={arrived ? 'Connected' : 'Give your agent my address'}
      hideTitle
      className="sm:[&_.ot-dialog-panel]:w-[min(520px,calc(100vw-2rem))]"
      actions={
        <Button variant={arrived ? 'primary' : 'secondary'} onClick={onClose} fullWidth>
          {arrived ? 'Done' : 'Close'}
        </Button>
      }
    >
      {arrived ? <Arrived agent={arrived} /> : null}

      <div className={cn('flex flex-col gap-[15px]', arrived && 'hidden')}>
        <header className="flex items-start gap-3">
          <div className="ot-drift flex-none">
            <Otto pose="plan-ready" size={56} animated />
          </div>
          <div className="flex flex-col gap-[3px]">
            <h2 className="font-display text-[19px] font-bold">Give your agent my address</h2>
            <p className="m-0 text-[13px] leading-[1.45] text-[var(--ot-text-2)]">
              One URL. I&rsquo;ll be listening on the other end.
            </p>
          </div>
        </header>

        <nav aria-label="Agent client" className="flex flex-wrap gap-1.5">
          {CONNECT_CLIENTS.map((entry) => (
            <button
              key={entry.key}
              type="button"
              aria-current={entry.key === client.key}
              onClick={() => setClientKey(entry.key)}
              className={cn(
                'flex cursor-pointer items-center gap-2 rounded-[var(--ot-radius-pill)] px-2.5 py-1.5',
                'text-[12px] transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ot-plan)]',
                entry.key === client.key
                  ? 'bg-[var(--ot-surface-2)] font-semibold text-[var(--ot-text)]'
                  : 'font-medium text-[var(--ot-text-3)] hover:bg-[var(--ot-surface-2)] hover:text-[var(--ot-text)]',
              )}
            >
              <AgentIcon name={entry.label} iconKey={entry.icon} size={18} className="rounded-[5px]" />
              {entry.label}
            </button>
          ))}
        </nav>

        <CopyRow value={payloadFor(client, MCP_URL)} />

        {client.steps ? (
          <ol className="m-0 flex list-none flex-col gap-[9px] p-0">
            {client.steps.map((step, i) => (
              <li key={step} className="flex gap-2.5 text-[13px] leading-[1.5]">
                <span className="flex-none font-mono text-[var(--ot-text-3)]">{i + 1}</span>
                <span>{step}</span>
              </li>
            ))}
          </ol>
        ) : null}

        <p className="m-0 text-[12.5px] leading-[1.5] text-[var(--ot-text-2)]">{client.note}</p>

        <Waiting />
      </div>
    </Dialog>
  )
}

/** The copy row. One control, and it says what it did. */
function CopyRow({ value }: { value: string }) {
  const [copied, setCopied] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])

  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => setCopied(false), 1600)
    } catch {
      // Clipboard refused — an insecure origin, or a browser that asks. The
      // text is selectable, which is why it is not hidden behind the button.
    }
  }, [value])

  return (
    <div className="flex items-center gap-2 rounded-[10px] bg-[var(--ot-surface-2)] px-3 py-2.5">
      <code className="ot-scroll flex-1 overflow-x-auto font-mono text-[12.5px] whitespace-nowrap">
        {value}
      </code>
      <Button variant="primary" size="sm" onClick={() => void copy()} className="flex-none">
        {copied ? 'Copied ✓' : 'Copy'}
      </Button>
    </div>
  )
}

/** The design's live handshake line. It is real: see useAgentArrival. */
function Waiting() {
  return (
    <div
      role="status"
      className="flex items-center gap-2.5 rounded-[10px] bg-[var(--ot-plan-bg)] px-3 py-2.5"
    >
      <span
        aria-hidden
        className="ot-spin h-3.5 w-3.5 flex-none rounded-full border-2 border-[var(--ot-plan-border)] border-t-[var(--ot-plan)]"
      />
      <span className="text-[13px] text-[var(--ot-plan-text)]">
        Waiting for your agent to say hello…
      </span>
    </div>
  )
}

function Arrived({ agent }: { agent: AgentGrant }) {
  const brand = agentBrand(agent.name, agent.redirectUris)
  return (
    <div className="flex flex-col items-center gap-3 py-2 text-center">
      <Otto pose="confirmed" size={72} animated />
      <div className="flex items-center gap-2">
        <AgentIcon name={agent.name} redirectUris={agent.redirectUris} size={26} />
        <h2 className="font-display text-[19px] font-bold">{brand.label} is connected</h2>
      </div>
      <p className="m-0 max-w-[36ch] text-[13px] leading-[1.5] text-[var(--ot-text-2)]">
        Ask it for a swap or a transfer and I&rsquo;ll build the plan. You review it, and you sign
        it — nothing moves before that.
      </p>
    </div>
  )
}

/** How often to look. Slow enough to be free, fast enough to feel live. */
const POLL_MS = 3000

/**
 * Watch for a grant that was not there when the dialog opened.
 *
 * Polling, because the transport is stateless and there is nothing to push
 * down. The baseline is taken once on open: an agent connected last week is not
 * news, and lighting up for it would tell someone their command worked when
 * they have not run it yet.
 */
function useAgentArrival(open: boolean): AgentGrant | null {
  const { state, refresh } = useAgents()
  const [wasOpen, setWasOpen] = useState(open)
  const [baseline, setBaseline] = useState<string[] | null>(null)

  const live = state.status === 'ready' ? state.agents.filter((a) => a.revokedAt === null) : []

  // Adjusting state during render when a prop changes — the pattern React
  // documents for this, rather than an effect that would reset a frame late.
  // Both branches are guarded so neither can loop.
  if (wasOpen !== open) {
    setWasOpen(open)
    setBaseline(null)
  } else if (open && baseline === null && state.status === 'ready') {
    // The list may still have been loading when the dialog opened, so the
    // baseline is taken at the first moment there is one to take.
    setBaseline(live.map((agent) => agent.id))
  }

  // Derived, not stored: the arrival is a fact about the list we already have,
  // and a second copy of it would only be a copy that could disagree.
  const arrived =
    open && baseline ? (live.find((agent) => !baseline.includes(agent.id)) ?? null) : null

  // The poll stops with the dialog, and once something has arrived — there is
  // nothing further to wait for, and a poll that outlives its reason is how a
  // page ends up talking to the server forever.
  useEffect(() => {
    if (!open || arrived) return
    const id = setInterval(refresh, POLL_MS)
    return () => clearInterval(id)
  }, [open, arrived, refresh])

  return arrived
}
