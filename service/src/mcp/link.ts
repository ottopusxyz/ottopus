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
 * How `baw` signs typed data, spelled out, because the CLI takes none of it
 * the obvious way: the message is a whole `eth_signTypedData_v4` request with
 * the typed data as a string inside it, signing is a preview and then an
 * execute, and the signature comes back in two fields without a 0x.
 */
function binanceSteps(challenge: AgentLinkChallenge): string[] {
  const { provider, typedData } = challenge
  const chainId = provider.chains[0]!.split(':')[1]
  const request = JSON.stringify({
    method: 'eth_signTypedData_v4',
    params: [typedData.message.wallet, JSON.stringify(typedData)],
  })
  return [
    'To sign it with baw (Developer Mode must be on in the Binance App; `baw wallet settings --json` shows devMode.enabled):',
    `1. Preview: baw sign-message preview --binanceChainId ${chainId} --signType EIP712 --message '${request}' --json`,
    '2. Show the person the parsed message and any risks from the preview, and ask before going on.',
    '3. Execute with the requestId the preview returned: baw sign-message execute --requestId <requestId> --json',
    '4. If the status is PENDING_CONFIRMATION, the person confirms in the Binance App; then fetch it with ' +
      'baw sign-message result --order-id <orderId> --json',
    '5. The result has `signature` and `signatureRecovery`. The signature to hand back is 0x, then `signature`, ' +
      'then `signatureRecovery`, as one hex string.',
    `The chain id only tells the CLI which network the wallet is on; do not add it to the typed data.`,
  ]
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
    ...(provider.id === 'binance' ? binanceSteps(challenge) : [`Sign it through \`${provider.cli} ${provider.sign.command}\`.`]),
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
