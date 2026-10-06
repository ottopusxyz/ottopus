import {
  type AgentLinkChallenge,
  type Arm,
  type FinishLinkInput,
  AGENT_PROVIDERS,
  type AgentProviderProfile,
  LinkError,
  type StartLinkInput,
  WalletError,
  agentProvider,
} from '../wallets/index.js'

/**
 * The two linking tools, as outcomes and as words.
 *
 * Start hands back typed data and how this vendor's CLI signs it; finish takes
 * the signature. The agent signs nothing through Ottopus: the wallet's own
 * CLI does, on the person's machine, and what comes back only proves which
 * address the agent operates.
 */
export interface LinkDeps {
  startAgentLink(userId: string, input: StartLinkInput): Promise<AgentLinkChallenge>
  finishAgentLink(userId: string, input: FinishLinkInput): Promise<Arm>
}

export type LinkOutcome<T> = { kind: 'ok'; value: T } | { kind: 'refused'; code: string; reason: string }

/** A refusal with a reason is an answer; anything else is a fault and is thrown on. */
async function attempt<T>(run: () => Promise<T>): Promise<LinkOutcome<T>> {
  try {
    return { kind: 'ok', value: await run() }
  } catch (err) {
    if (err instanceof LinkError || err instanceof WalletError) {
      return { kind: 'refused', code: err.code, reason: err.message }
    }
    throw err
  }
}

export const startLink = (deps: LinkDeps, userId: string, input: StartLinkInput) =>
  attempt(() => deps.startAgentLink(userId, input))

export const finishLink = (deps: LinkDeps, userId: string, input: FinishLinkInput) =>
  attempt(() => deps.finishAgentLink(userId, input))

/**
 * What the two tools say about vendors before either is called, read off the
 * registry: an agent learns a provider exists from these and from nowhere
 * else, so a profile added there is named here without another edit.
 */
export function linkToolWords(providers: readonly AgentProviderProfile[] = Object.values(AGENT_PROVIDERS)) {
  return {
    /** "Binance Agentic Wallet through baw", for the middle of a sentence. */
    vendors: providers.map((provider) => `${provider.name} through ${provider.cli}`).join(', or '),
    provider:
      'Whose agent wallet it is: ' +
      providers.map((provider) => `"${provider.id}" for ${provider.name}`).join(', ') +
      '.',
    signature:
      'The 65-byte signature the wallet produced over the typed data, as hex. ' +
      providers.map((provider) => `From ${provider.cli}: ${provider.sign.handBack}.`).join(' '),
  }
}

/**
 * The typed data is in the words as well as the structured copy: some hosts
 * show a model only the text, and it cannot sign what it was not shown.
 */
export function startText(challenge: AgentLinkChallenge): string {
  const { provider, typedData } = challenge
  return [
    `Challenge ${challenge.challengeId} for ${typedData.message.wallet}, a ${provider.name}. It expires at ${challenge.expiresAt}.`,
    'Sign the EIP-712 typed data below with that wallet. It only proves the wallet is yours to operate; ' +
      'it moves nothing and approves nothing.',
    JSON.stringify(typedData),
    ...provider.signSteps({ address: typedData.message.wallet, typedData }),
    'Then call link_agent_wallet_finish with the challengeId and the signature.',
  ].join('\n')
}

export function finishText(arm: Arm): string {
  const name = agentProvider(arm.agentProvider)?.name ?? 'agent wallet'
  return (
    `Linked ${arm.address} as a ${name}. It now appears in list_wallets and in Settings in Ottopus, ` +
    'where the person can name it or unlink it.'
  )
}
