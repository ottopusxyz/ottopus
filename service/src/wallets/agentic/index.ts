import type { Arm } from '../store.js'
import { binance } from './binance.js'
import type { AgentProviderProfile } from './types.js'

export type { AgentProviderProfile, SignRequest } from './types.js'

/** The kind every agent-operated arm carries; the vendor is `agentProvider`. */
export const AGENTIC = 'agentic'

/** The registry. A provider not here is not a provider. */
export const AGENT_PROVIDERS: Readonly<Record<string, AgentProviderProfile>> = {
  [binance.id]: binance,
}

/** Own keys only, so `constructor` and friends are not providers. */
export function agentProvider(id: string | null | undefined): AgentProviderProfile | null {
  return id && Object.hasOwn(AGENT_PROVIDERS, id) ? AGENT_PROVIDERS[id]! : null
}

/** The profile behind an arm, or null for an arm a person signs with (or cannot). */
export function profileOf(arm: Pick<Arm, 'walletType' | 'agentProvider'>): AgentProviderProfile | null {
  return arm.walletType === AGENTIC ? agentProvider(arm.agentProvider) : null
}

/**
 * What an arm can do, in the three ways the rest of the service asks.
 *
 * `canSign` is the scorer's question: can this arm carry out what a plan
 * needs. An agentic arm can — through its vendor's CLI rather than a wallet
 * connected on the review page, which is what the other two say.
 */
export interface ArmCapabilities {
  canSign: boolean
  /** The review page can connect it and ask for a signature. */
  browserSigner: boolean
  /** The agent's own wallet sends an approved plan's calls. */
  agentExecutes: boolean
}

export function capabilitiesOf(
  arm: Pick<Arm, 'walletType' | 'agentProvider' | 'isWatchOnly' | 'provedAt'>,
): ArmCapabilities {
  const proved = !arm.isWatchOnly && arm.provedAt !== null
  const agentExecutes = proved && profileOf(arm) !== null
  // An agentic row whose provider left the registry can do nothing: there is
  // no browser to connect it in and no profile to execute it through.
  const browserSigner = proved && arm.walletType !== AGENTIC
  return { canSign: browserSigner || agentExecutes, browserSigner, agentExecutes }
}
