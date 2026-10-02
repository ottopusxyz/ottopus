/**
 * What the plugin remembers about the plan it is showing. Everything here
 * came back from a prepare_* call the agent made: words, a link, an expiry.
 * No calls, no calldata, nothing a wallet could send.
 */
export type CapturedPlan = {
  planId: string
  /** The MCP server the plan came from, as the tool name spelled it. */
  server: string
  tool: 'prepare_trade' | 'prepare_transfer' | 'prepare_custom'
  /** The service's own word, shown as it is. Unknown words are kept, not mapped. */
  status: string
  summary: string
  /** Why this wallet, in the scorer's words. Absent on a custom plan, which names its own. */
  reason: string | null
  account: string | null
  route: string | null
  expectedOut: string | null
  minOut: string | null
  feesUsd: string | null
  warnings: string[]
  /** Why verification refused it. Empty unless blocked. */
  reasons: string[]
  expiresAt: string | null
  /** When the plugin first saw the plan, on its own clock: the start the quote's share left is measured from. */
  capturedAt?: number
  /** Null on a blocked plan: a refusal never gets a link. */
  reviewUrl: string | null
}

declare module 'claude-code' {
  interface PluginState {
    ottopus: {
      plan: CapturedPlan | null
    }
  }
}
