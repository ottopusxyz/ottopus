import type { AgentProviderProfile, ExecuteRequest, SignRequest } from './types.js'

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
 * How `baw` sends a plan's calls. Each call is its own preview and execute;
 * the preview is where the wallet's own simulation and risk check run, and a
 * preview it refuses has no requestId to execute. Value and calldata are left
 * off the command when a call has none, and gas is the CLI's to estimate.
 */
function executeSteps({ address, calls }: ExecuteRequest): string[] {
  const previews = calls.map((call, i) => {
    const value = call.value === '0' ? '' : ` --value ${call.value}`
    const data = call.data === '0x' ? '' : ` --inputData ${call.data}`
    return (
      `Call ${i + 1} of ${calls.length}: baw contract-call preview --binanceChainId ${call.chainReference} ` +
      `--from ${address} --to ${call.to}${value}${data} --json`
    )
  })
  return [
    'To send it with baw (Developer Mode must be on in the Binance App; `baw wallet settings --json` shows devMode.enabled).',
    `One call at a time, in this order${calls.length > 1 ? '; do not start a call until the one before it has confirmed on chain' : ''}:`,
    ...previews,
    'For each call:',
    '1. Run its preview exactly as written. Do not change the addresses, the value or the input data, and do not add gas ' +
      'options: these are what was approved.',
    '2. Show the person the preview’s parsedTx, simulationResult and risks.',
    '3. If the preview is refused (AGENT_DEV_MODE_RISK_BLOCKED, for one) or returns no requestId, stop there and say so. ' +
      'Do not retry it another way.',
    '4. Execute with the requestId the preview returned: baw contract-call execute --requestId <requestId> --json',
    '5. BROADCASTED carries the txHash. PENDING_CONFIRMATION means the person confirms in the Binance App first; ' +
      'the hash is then in baw wallet tx-history --json.',
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
  executeSteps,
}
