import { type Hex, TransactionNotFoundError, createPublicClient, http } from 'viem'
import { RpcReadError, rpcUrlFor, viemChainFor } from '../core/index.js'

/**
 * Who sent a transaction, as the chain tells it. What an agent's execution
 * report is held against: a hash proves nothing by itself, and the address
 * that signed it is the one fact about it the agent cannot choose.
 */
export interface SenderReader {
  /** The sender, lowercased, or null while the chain has not seen the hash. Throws when the chain cannot be read. */
  sender(chainId: string, txHash: string): Promise<string | null>
}

export interface HttpSenderOptions {
  rpcUrlTemplate?: string | undefined
  timeoutMs?: number
  fetch?: typeof fetch
}

/** Over JSON-RPC, through the same registry and the same sanitised errors as the receipt reads. */
export function httpSenderReader(options: HttpSenderOptions = {}): SenderReader {
  const doFetch = options.fetch ?? fetch
  const timeout = options.timeoutMs ?? 8_000
  return {
    async sender(chainId, txHash) {
      const client = createPublicClient({
        chain: viemChainFor(chainId),
        transport: http(rpcUrlFor(chainId, options.rpcUrlTemplate), { timeout, fetchFn: doFetch }),
      })
      try {
        const tx = await client.getTransaction({ hash: txHash as Hex })
        return tx.from.toLowerCase()
      } catch (err) {
        if (err instanceof TransactionNotFoundError) return null
        throw new RpcReadError(chainId, err)
      }
    },
  }
}
