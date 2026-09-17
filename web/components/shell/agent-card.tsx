import { Button } from '@/components/ui'

/**
 * The pinned card at the bottom of the sidebar.
 *
 * A slot, not a fixture: #14 replaces the body with the connect-agent dialog
 * trigger and the connected state, and it does that here rather than by editing
 * the shell. The shell only decides where it sits.
 *
 * Until then it states the honest default — nothing is listening, so nothing
 * can be prepared.
 */
export function AgentCard() {
  return (
    <div className="flex flex-col gap-[10px] rounded-[12px] bg-[var(--ot-surface-2)] p-[14px]">
      <span className="text-[13px] font-semibold">No agent connected</span>
      <span className="text-[12px] leading-[1.45] text-[var(--ot-text-2)]">
        Otto can&rsquo;t prepare anything until an agent is listening.
      </span>
      <Button variant="primary" size="sm" className="w-fit text-[12px]">
        Connect agent
      </Button>
    </div>
  )
}
