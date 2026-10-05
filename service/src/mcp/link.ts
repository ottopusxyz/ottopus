import {
  type AgentLinkChallenge,
  type Arm,
  type FinishLinkInput,
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
 * The typed data is in the words as well as the structured copy: some hosts
 * show a model only the text, and it cannot sign what it was not shown.
 */
export function startText(challenge: AgentLinkChallenge): string {
  const { provider, typedData } = challenge
  return [
    `Challenge ${challenge.challengeId} for ${typedData.message.wallet}, a ${provider.name}. It expires at ${challenge.expiresAt}.`,
    `Sign the EIP-712 typed data below with that wallet through \`${provider.cli} ${provider.sign.command}\`: ` +
      'run the preview, show the person what it says, then execute. It only proves the wallet is yours to operate; ' +
      'it moves nothing and approves nothing.',
    'Then call link_agent_wallet_finish with the challengeId and the 0x signature.',
    JSON.stringify(typedData),
  ].join('\n')
}

export function finishText(arm: Arm): string {
  const name = agentProvider(arm.agentProvider)?.name ?? 'agent wallet'
  return (
    `Linked ${arm.address} as a ${name}. It now appears in list_wallets and in Settings in Ottopus, ` +
    'where the person can name it or unlink it.'
  )
}
