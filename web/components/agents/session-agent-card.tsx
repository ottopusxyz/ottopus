'use client'

import Link from 'next/link'
import { useState } from 'react'
import { usePrivyAvailable } from '@/components/auth'
import { AgentCard } from '@/components/shell'
import { AgentIcon } from './agent-icon'
import { agentBrand } from './agent-brand'
import { ConnectAgentDialog } from './connect-agent-dialog'
import { useAgents } from './use-agents'

/**
 * Fills the shell's agent slot, the way SessionAccountRow fills the account one.
 *
 * The shell keeps no knowledge of grants — it decides where the card sits, and
 * this decides what it says. Without that seam the sidebar would have to import
 * the API client, and every page in the shell would pay for it.
 *
 * Falls back to the shell's own card whenever there is nothing to show: Privy
 * unconfigured, still loading, or genuinely no agents. That card already states
 * the honest default, and a second way of saying "nothing is listening" would
 * be one more thing to keep in agreement.
 */
export function SessionAgentCard() {
  return usePrivyAvailable() ? <LiveAgentCard /> : <AgentCard />
}

function LiveAgentCard() {
  const { state } = useAgents()
  // Only the empty card opens the dialog; once something is connected the card
  // points at Settings, which has its own Connect agent button.
  const [connecting, setConnecting] = useState(false)
  const live = state.status === 'ready' ? state.agents.filter((a) => a.revokedAt === null) : []

  // The shell's card has said "Connect agent" since #51 with nothing behind the
  // button. Same card, same words — now it opens the dialog.
  if (live.length === 0) {
    return (
      <>
        <AgentCard onConnect={() => setConnecting(true)} />
        <ConnectAgentDialog open={connecting} onClose={() => setConnecting(false)} />
      </>
    )
  }

  const [first] = live
  const brand = agentBrand(first!.name, first!.redirectUris)

  return (
    <div className="flex flex-col gap-[10px] rounded-[12px] bg-[var(--ot-surface-2)] p-[14px]">
      <div className="flex items-center gap-2.5">
        <AgentIcon name={first!.name} redirectUris={first!.redirectUris} size={26} />
        <div className="flex min-w-0 flex-col">
          <span title={first!.name} className="truncate text-[13px] font-semibold">
            {brand.label}
          </span>
          <span className="text-[12px] text-[var(--ot-text-3)]">
            {live.length > 1 ? `and ${live.length - 1} more` : 'Connected'}
          </span>
        </div>
      </div>
      {/* Settings is where a grant is read and ended, so the card points there
          rather than describing what it could do. */}
      {/* One link, not two. The column is 216px wide and a second action wraps
          both of them onto three lines — and Settings, where this goes, is
          where connecting another one lives anyway. */}
      <Link
        href="/settings"
        className="w-fit text-[12px] font-medium whitespace-nowrap text-[var(--ot-plan-text)] underline underline-offset-[3px] hover:text-[var(--ot-text)]"
      >
        Manage access
      </Link>
    </div>
  )
}
