'use client'

import { useState } from 'react'
import { Button, Chip, Dialog } from '@/components/ui'
import type { AgentGrant } from '@/lib/api'
import { cn } from '@/lib/cn'
import { agentBrand, surfaceLabel } from './agent-brand'
import { AgentIcon } from './agent-icon'
import { ScopeChips } from './agents-panel'

export interface AgentListProps {
  agents: AgentGrant[]
  onRevoke: (id: string) => Promise<void>
}

/**
 * When something last happened, in words a person reads rather than a timestamp
 * they decode. "Never" is a real answer here and a useful one: an agent that
 * was authorised and has never called anything is usually one somebody set up
 * and forgot.
 */
function ago(iso: string | null): string {
  if (!iso) return 'Never used'
  const seconds = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000)
  if (seconds < 90) return 'Active just now'
  const minutes = seconds / 60
  if (minutes < 60) return `Active ${Math.round(minutes)} min ago`
  const hours = minutes / 60
  if (hours < 24) return `Active ${Math.round(hours)}h ago`
  const days = Math.round(hours / 24)
  return `Active ${days} day${days === 1 ? '' : 's'} ago`
}

const onDay = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })

export function AgentList({ agents, onRevoke }: AgentListProps) {
  const [confirming, setConfirming] = useState<AgentGrant | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function dismiss() {
    if (busy) return
    setConfirming(null)
    setError(null)
  }

  async function confirm() {
    if (!confirming) return
    setBusy(true)
    setError(null)
    try {
      await onRevoke(confirming.id)
      setConfirming(null)
    } catch {
      // The dialog stays open holding the error. Closing it on failure would
      // look exactly like success, and the agent would still be able to act.
      setError('That grant is still active. Nothing changed — try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <ul className="m-0 flex list-none flex-col p-0">
        {agents.map((agent) => {
          const revoked = agent.revokedAt !== null
          const brand = agentBrand(agent.name, agent.redirectUris)
          const surface = surfaceLabel(brand.surface)
          return (
            <li
              key={agent.id}
              className={cn(
                'flex flex-wrap items-start justify-between gap-3 border-t border-[var(--ot-border)] px-[22px] py-4 first:border-t-0',
                revoked && 'opacity-60',
              )}
            >
              <div className="flex min-w-0 items-start gap-3">
                <AgentIcon name={agent.name} redirectUris={agent.redirectUris} />
                <div className="flex min-w-0 flex-col gap-1.5">
                  <div className="flex flex-wrap items-center gap-2">
                    {/* The tidied name reads better; the raw one is what the
                        agent actually called itself, and nothing verified it,
                        so it stays reachable rather than being replaced. */}
                    <span title={agent.name} className="text-[15px] font-semibold">
                      {brand.label}
                    </span>
                    {surface ? <Chip className="text-[11px]">{surface}</Chip> : null}
                    <span className="text-[12px] text-[var(--ot-text-3)]">
                      {revoked
                        ? `Revoked ${onDay(agent.revokedAt!)}`
                        : `${ago(agent.lastUsedAt)} · since ${onDay(agent.grantedAt)}`}
                    </span>
                  </div>
                  {revoked ? null : <ScopeChips agent={agent} />}
                </div>
              </div>

              {revoked ? null : (
                <Button
                  variant="danger-outline"
                  size="sm"
                  onClick={() => setConfirming(agent)}
                  aria-label={`Revoke ${agent.name}`}
                >
                  Revoke
                </Button>
              )}
            </li>
          )
        })}
      </ul>

      <Dialog
        open={confirming !== null}
        onClose={dismiss}
        tone="destructive"
        title={`Revoke ${confirming ? agentBrand(confirming.name, confirming.redirectUris).label : ''}?`}
        // The consequence, both halves of it. #27 asks for this explicitly, and
        // the second half is the one that stops the confirm feeling dangerous:
        // revoking cannot undo anything that already happened.
        description="This agent stops being able to prepare requests immediately. Anything you already signed is unaffected, and you can connect it again whenever you like."
        actions={
          <>
            <Button variant="ghost" onClick={dismiss} disabled={busy} fullWidth>
              Keep it
            </Button>
            <Button variant="destructive" onClick={() => void confirm()} disabled={busy} fullWidth>
              {busy ? 'Revoking…' : 'Revoke'}
            </Button>
          </>
        }
      >
        {error ? (
          <p role="alert" className="text-[13px] leading-[1.5] text-[var(--ot-block-text)]">
            {error}
          </p>
        ) : null}
      </Dialog>
    </>
  )
}
