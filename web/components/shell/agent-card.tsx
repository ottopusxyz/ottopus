import { Button } from '@/components/ui'

/**
 * The pinned card at the bottom of the sidebar.
 *
 * A slot, not a fixture: SessionAgentCard swaps in the connected state and
 * supplies the handler, and it does that here rather than by editing the shell.
 * The shell only decides where it sits and what it says when nothing is.
 *
 * The button is disabled without a handler rather than hidden — this card is
 * also rendered on the styleguide, where there is no dialog to open, and a
 * button that quietly vanishes is harder to notice missing than one that is
 * plainly unavailable.
 */
export function AgentCard({ onConnect }: { onConnect?: () => void } = {}) {
  return (
    <div className="flex flex-col gap-[10px] rounded-[12px] bg-[var(--ot-surface-2)] p-[14px]">
      <span className="text-[13px] font-semibold">No agent connected</span>
      <span className="text-[12px] leading-[1.45] text-[var(--ot-text-2)]">
        Otto can&rsquo;t prepare anything until an agent is listening.
      </span>
      <Button
        variant="primary"
        size="sm"
        className="w-fit text-[12px]"
        onClick={onConnect}
        disabled={!onConnect}
      >
        Connect agent
      </Button>
    </div>
  )
}
