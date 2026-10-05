import type { AgentProviderProfile } from './types.js'

/**
 * Binance Agentic Wallet, driven through `baw`. Both commands are a preview
 * the agent shows and an execute that acts on it; `contract-call` is refused
 * by the CLI until Developer Mode is on in the wallet's settings.
 */
export const binance: AgentProviderProfile = {
  id: 'binance',
  name: 'Binance Agentic Wallet',
  cli: 'baw',
  chains: ['eip155:56', 'eip155:1', 'eip155:8453'],
  sign: { command: 'sign-message preview/execute', typedData: true },
  execute: { command: 'contract-call preview/execute', requiresDevMode: true },
}
