import type { AgentIconKey } from '@/components/agents/agent-brand'
import { CONNECT_CLIENTS } from '@/components/agents/connect-clients'

/**
 * The marks the "Add to your agent" button turns through while it waits:
 * one per client it can connect, in the panel's order, each once. Claude Code
 * and Claude share a mark, so it shows once; the generic bot stays out, since
 * "any client" is a fallback rather than a name worth flashing.
 */
export const TRIGGER_MARKS: readonly { icon: AgentIconKey; label: string }[] = CONNECT_CLIENTS.filter(
  (entry, i, all) => entry.icon !== 'other' && all.findIndex((other) => other.icon === entry.icon) === i,
).map((entry) => ({ icon: entry.icon, label: entry.label }))

/** How long each mark holds. Slow enough to read, quick enough to notice. */
export const TRIGGER_MARK_MS = 1800
