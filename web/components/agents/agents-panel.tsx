'use client'

import { useState, type ReactNode } from 'react'
import { usePrivyAvailable } from '@/components/auth'
import { Otto } from '@/components/brand'
import { SkeletonShelf } from '@/components/motion/loaders'
import { Callout, Chip, EmptyState } from '@/components/ui'
import type { AgentGrant } from '@/lib/api'
import { AgentList } from './agent-list'
import { useAgents } from './use-agents'

/**
 * Settings' agent card, beside the wallets one.
 *
 * Split the same way WalletsPanel is, and for the same reason: Privy's hooks
 * throw outside their provider, the provider does not mount without a valid app
 * id, and a hook cannot be called conditionally.
 */
export function AgentsPanel() {
  return usePrivyAvailable() ? (
    <ConnectedPanel />
  ) : (
    <Card>
      <div className="px-[22px] py-4">
        <Callout severity="caution" title="Sign-in isn’t configured">
          Agent grants need Privy, and this deployment has no valid app id. Nothing is wrong with
          your account.
        </Callout>
      </div>
    </Card>
  )
}

/** Live means "may act right now": granted, and not revoked. */
const isLive = (agent: AgentGrant) => agent.revokedAt === null

function ConnectedPanel() {
  const { state, revoke } = useAgents()
  const [showRevoked, setShowRevoked] = useState(false)
  const agents = state.status === 'ready' ? state.agents : []
  const live = agents.filter(isLive)
  const revoked = agents.filter((agent) => !isLive(agent))

  return (
    <Card count={state.status === 'ready' ? live.length : undefined}>
      {state.status === 'failed' ? (
        <div className="px-[22px] pt-4">
          <Callout severity="caution" title="Can’t reach Ottopus right now">
            Your grants are unchanged — this is our side. Try again in a moment.
          </Callout>
        </div>
      ) : null}

      {/* The count is live grants, so the empty state has to key off the same
          thing. Listing revoked ones under "Connected agents 0" reads as a
          contradiction, and someone whose only grants are revoked still needs
          telling how to connect one. */}
      {state.status === 'loading' ? (
        <SkeletonShelf rows={2} />
      ) : live.length === 0 ? (
        <div className="px-[22px] py-7">
          <EmptyState
            title={revoked.length > 0 ? 'No agents connected' : 'No agents yet'}
            description="Add the Ottopus MCP server to Claude or Codex, and the grant you approve will show up here."
            illustration={<Otto pose="base" size={96} animated />}
          />
        </div>
      ) : (
        <AgentList agents={live} onRevoke={revoke} />
      )}

      {/* Kept, because a revoked grant is the record that an agent once had
          access and no longer does — but folded away, since it accumulates one
          row per revocation and none of them can do anything. */}
      {revoked.length > 0 ? (
        <div className="border-t border-[var(--ot-border)]">
          <button
            type="button"
            aria-expanded={showRevoked}
            onClick={() => setShowRevoked((open) => !open)}
            className="flex w-full cursor-pointer items-center justify-between gap-3 px-[22px] py-3 text-[12.5px] text-[var(--ot-text-2)] transition-colors hover:text-[var(--ot-text)] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--ot-plan)]"
          >
            <span>
              Previously connected{' '}
              <span className="text-[var(--ot-text-3)]">{revoked.length}</span>
            </span>
            <span aria-hidden className="text-[var(--ot-text-3)]">
              {showRevoked ? 'Hide' : 'Show'}
            </span>
          </button>
          {showRevoked ? <AgentList agents={revoked} onRevoke={revoke} /> : null}
        </div>
      ) : null}

      <p className="border-t border-[var(--ot-border)] bg-[var(--ot-surface-2)] px-[22px] py-3.5 text-[12.5px] leading-[1.5] text-[var(--ot-text-2)]">
        No grant can sign or move anything. Revoking one stops it preparing new requests
        immediately.
      </p>
    </Card>
  )
}

/** The P6 frame, matching the wallets card it sits beside. */
function Card({ children, count }: { children: ReactNode; count?: number | undefined }) {
  return (
    <section className="overflow-hidden rounded-[18px] border border-[var(--ot-border)] bg-[var(--ot-card)]">
      <div className="flex items-center justify-between gap-4 border-b border-[var(--ot-border)] px-[22px] py-4">
        <h2 className="text-[15px] font-semibold">
          Connected agents{' '}
          {count !== undefined ? (
            <span className="font-normal text-[var(--ot-text-3)]">{count}</span>
          ) : null}
        </h2>
      </div>
      {children}
    </section>
  )
}

/** Exported for the list, which shows the same chip for each granted scope. */
export function ScopeChips({ agent }: { agent: AgentGrant }) {
  const [expanded, setExpanded] = useState(false)
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {agent.scopes.map((scope) => (
        <Chip key={scope.scope} className="text-[11px]">
          {scope.title}
        </Chip>
      ))}
      {agent.scopes.length > 0 ? (
        <button
          type="button"
          onClick={() => setExpanded((open) => !open)}
          className="cursor-pointer rounded-full px-1.5 py-0.5 text-[11px] text-[var(--ot-text-3)] transition-colors hover:text-[var(--ot-text)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ot-plan)]"
        >
          {expanded ? 'Less' : 'What this means'}
        </button>
      ) : null}
      {expanded ? (
        <ul className="mt-1 flex w-full list-none flex-col gap-1 p-0">
          {agent.scopes.map((scope) => (
            <li key={scope.scope} className="text-[12px] leading-[1.45] text-[var(--ot-text-2)]">
              <span className="font-medium text-[var(--ot-text)]">{scope.title}</span> —{' '}
              {scope.detail}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
