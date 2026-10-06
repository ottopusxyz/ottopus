import { type Hex, TransactionNotFoundError, createPublicClient, http } from 'viem'
import { RpcReadError, rpcUrlFor, viemChainFor } from '../core/index.js'

/**
 * A transaction as the chain tells it: who sent it, to where, with what.
 * What an agent's execution report is held against. A hash proves nothing by
 * itself; the address that signed it is the one fact about it the agent
 * cannot choose, and the destination, value and calldata are what say it was
 * this plan's call and not something else that wallet once sent.
 */
export interface SentTransaction {
  /** Lowercased. */
  from: string
  /** Lowercased. Null for a contract creation. */
  to: string | null
  /** Wei, as a decimal string. */
  value: string
  /** Calldata, lowercased; `0x` when there is none. */
  input: string
}

export interface SenderReader {
  /** The transaction, or null while the chain has not seen the hash. Throws when the chain cannot be read. */
  sent(chainId: string, txHash: string): Promise<SentTransaction | null>
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
    async sent(chainId, txHash) {
      const client = createPublicClient({
        chain: viemChainFor(chainId),
        transport: http(rpcUrlFor(chainId, options.rpcUrlTemplate), { timeout, fetchFn: doFetch }),
      })
      try {
        const tx = await client.getTransaction({ hash: txHash as Hex })
        return {
          from: tx.from.toLowerCase(),
          to: tx.to?.toLowerCase() ?? null,
          value: tx.value.toString(),
          input: tx.input.toLowerCase(),
        }
      } catch (err) {
        if (err instanceof TransactionNotFoundError) return null
        throw new RpcReadError(chainId, err)
      }
    },
  }
}
