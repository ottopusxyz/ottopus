/**
 * What Ottopus needs to know about a vendor's agent-operated wallet.
 *
 * An agentic wallet has no EIP-1193 or WalletConnect surface: the only way to
 * reach it is the vendor's CLI, run by the agent on the person's machine. The
 * key stays with the vendor. Everything above this profile is the same for
 * every vendor; what differs — which CLI, how a challenge is signed, how a
 * plan's calls are executed — lives here.
 */
export interface AgentProviderProfile {
  /** Stored in `linked_wallets.agent_provider`. */
  id: string
  /** What a person calls it. */
  name: string
  /** The command the agent runs. */
  cli: string
  /** CAIP-2 chains the wallet can execute on. */
  chains: readonly string[]
  /**
   * How the agent signs a linking challenge. `handBack` says which of the
   * CLI's output makes the 65 bytes to return, as it reads after "From <cli>:".
   */
  sign: { command: string; typedData: boolean; handBack: string }
  /** The same, as the lines the agent is told: every command, in order. */
  signSteps(request: SignRequest): string[]
  /** How the agent executes a plan's calls, one call at a time. */
  execute: { command: string; requiresDevMode: boolean }
}

/** What a profile is handed to spell out its signing steps: the account, and the typed data whole. */
export interface SignRequest {
  address: string
  typedData: object
}
