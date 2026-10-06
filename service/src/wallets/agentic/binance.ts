import type { AgentProviderProfile, SignRequest } from './types.js'

const CHAINS = ['eip155:56', 'eip155:1', 'eip155:8453'] as const

/**
 * How `baw` signs typed data, spelled out, because the CLI takes none of it
 * the obvious way: the message is a whole `eth_signTypedData_v4` request with
 * the typed data as a string inside it, signing is a preview and then an
 * execute, and the signature comes back in two fields without a 0x.
 */
function signSteps({ address, typedData }: SignRequest): string[] {
  const chainId = CHAINS[0].split(':')[1]
  const request = JSON.stringify({
    method: 'eth_signTypedData_v4',
    params: [address, JSON.stringify(typedData)],
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
 * Binance Agentic Wallet, driven through `baw`. Both commands are a preview
 * the agent shows and an execute that acts on it; `contract-call` is refused
 * by the CLI until Developer Mode is on in the wallet's settings.
 */
export const binance: AgentProviderProfile = {
  id: 'binance',
  name: 'Binance Agentic Wallet',
  cli: 'baw',
  chains: CHAINS,
  sign: {
    command: 'sign-message preview/execute',
    typedData: true,
    handBack: 'its signature followed by its signatureRecovery',
  },
  signSteps,
  execute: { command: 'contract-call preview/execute', requiresDevMode: true },
}
