'use client'

import { useState } from 'react'
import { AgentIcon } from '@/components/agents/agent-icon'
import { CONNECT_CLIENTS, payloadFor } from '@/components/agents/connect-clients'
import { cn } from '@/lib/cn'

/**
 * The one line that connects an agent, on the landing page. The same commands
 * the in-app connect dialog offers, for the clients people arrive with. The
 * address is the public one: this page is signed out, so it cannot ask the
 * service for it the way the dialog does.
 */
export const PUBLIC_MCP_URL = 'https://mcp.ottopus.xyz'

const SHOWN = ['claude-code', 'claude-desktop', 'codex', 'hermes'] as const
const CLIENTS = SHOWN.map((key) => CONNECT_CLIENTS.find((c) => c.key === key)!)

export function ConnectTabs() {
  const [active, setActive] = useState(0)
  const [copied, setCopied] = useState(false)
  const client = CLIENTS[active]!
  const payload = payloadFor(client, PUBLIC_MCP_URL)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(payload)
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    } catch {
      // No clipboard (an insecure origin, a denied permission): the text is
      // selectable right there, so there is nothing to recover.
    }
  }

  return (
    <div className="overflow-hidden rounded-[var(--ot-radius-md)] border border-[var(--ot-border)] bg-[var(--ot-card)]">
      <div role="tablist" aria-label="Your agent" className="flex gap-1 overflow-x-auto border-b border-[var(--ot-border)] p-1.5">
        {CLIENTS.map((c, i) => (
          <button
            key={c.key}
            type="button"
            role="tab"
            aria-selected={i === active}
            onClick={() => {
              setActive(i)
              setCopied(false)
            }}
            className={cn(
              'inline-flex shrink-0 cursor-pointer items-center gap-2 rounded-full px-3 py-1.5 text-[13px] font-medium transition-colors',
              i === active
                ? 'bg-[var(--ot-surface-3)] text-[var(--ot-text)]'
                : 'text-[var(--ot-text-3)] hover:text-[var(--ot-text)]',
            )}
          >
            <AgentIcon name={c.label} iconKey={c.icon} size={18} className="rounded-[5px]" />
            {c.label}
          </button>
        ))}
      </div>

      <div role="tabpanel" className="flex flex-col gap-2.5 p-4">
        <div className="flex items-center gap-2 rounded-[10px] bg-[var(--ot-navy)] py-2 pr-2 pl-3.5">
          <code className="min-w-0 flex-1 overflow-x-auto font-mono text-[13px] whitespace-nowrap text-[var(--ot-cream)]">
            {client.command ? <span className="mr-2 select-none text-[var(--ot-coral)]">$</span> : null}
            {payload}
          </code>
          <button
            type="button"
            onClick={copy}
            className="shrink-0 cursor-pointer rounded-full bg-[rgba(255,240,220,0.12)] px-3 py-1.5 text-[12px] font-medium text-[var(--ot-cream)] transition-colors hover:bg-[rgba(255,240,220,0.2)]"
          >
            <span aria-live="polite">{copied ? 'Copied' : 'Copy'}</span>
          </button>
        </div>
        <p className="m-0 text-[13px] leading-[1.5] text-[var(--ot-text-3)]">
          {client.steps ? client.steps.join(' ') : client.note}
        </p>
      </div>
    </div>
  )
}
