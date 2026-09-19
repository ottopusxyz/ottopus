import { type Hex, createPublicClient, http } from 'viem'
import { simulateCalls } from 'viem/actions'
import { RpcReadError, findChain, parseAccountId, parseChainId, rpcUrlFor, viemChainFor } from '../../core/index.js'
import { deltasFrom, resultHashOf } from './diff.js'
import type { SimulationRequest, SimulationRun, Simulator } from './types.js'

/**
 * Layer 1: the deterministic baseline, on nobody's API.
 *
 * `eth_simulateV1` is the standardised multi-call simulation RPC, so this
 * runs wherever the chain registry can reach a node — no vendor account, no
 * per-chain integration, nothing to expire. It is also the honest answer to
 * "who simulated this": the chain's own execution client did.
 *
 * Asset deltas come from the same method rather than from a vendor's
 * enrichment: viem's `traceAssetChanges` reads the account's balances before
 * and after inside the simulated block, using state overrides, and reports
 * the difference per token. That is the layer-2 feature everybody sells,
 * available at layer 1, and it is why the rich vendor is an upgrade rather
 * than a dependency.
 *
 * Two degradations, in order, because a plan with no simulation is worse than
 * a plan with a thin one:
 *
 *   1. Tracing refused → re-run without it. Success, gas and the revert
 *      reason still hold; `tracedAssets` says the balances were not observed,
 *      so nothing downstream mistakes an empty list for "nothing moves".
 *   2. `eth_simulateV1` missing → `eth_call` per call plus `eth_estimateGas`.
 *      Independent calls, so a batch whose second call depends on its first
 *      reads pessimistically; single-call plans, which is every transfer, are
 *      exact.
 */

export interface BaselineOptions {
  rpcUrlTemplate?: string | undefined
  /** Generous: the review page waits on this, but a wrong answer is worse than a slow one. */
  timeoutMs?: number
  fetch?: typeof fetch
  now?: () => Date
}

export const BASELINE_PROVIDER = 'eth_simulateV1'

export function baselineSimulator(options: BaselineOptions = {}): Simulator {
  const doFetch = options.fetch ?? fetch
  const timeout = options.timeoutMs ?? 10_000
  const now = options.now ?? (() => new Date())

  const clientFor = (chainId: string) =>
    createPublicClient({
      chain: viemChainFor(chainId),
      transport: http(rpcUrlFor(chainId, options.rpcUrlTemplate), { timeout, fetchFn: doFetch }),
    })

  return {
    name: BASELINE_PROVIDER,

    serves(chainId) {
      // Every EVM chain the registry knows has an RPC to try. Whether that
      // node implements eth_simulateV1 is discovered by asking, not guessed.
      return parseChainId(chainId).namespace === 'eip155' && findChain(chainId) !== null
    },

    async simulate(request) {
      const client = clientFor(request.chainId)
      const account = parseAccountId(request.account).address as Hex
      const calls = request.calls.map((call) => ({
        to: parseAccountId(call.to).address as Hex,
        value: BigInt(call.value),
        ...(call.data && call.data !== '0x' ? { data: call.data as Hex } : {}),
      }))

      for (const traceAssetChanges of [true, false]) {
        try {
          const result = await simulateCalls(client, { account, calls, traceAssetChanges })
          const failedIndex = result.results.findIndex((r) => r.status === 'failure')
          const failed = failedIndex >= 0 ? result.results[failedIndex] : undefined
          const gasUsed = result.results.reduce((total, r) => total + (r.gasUsed ?? 0n), 0n)
          const conclusions = {
            chainId: request.chainId,
            blockNumber: (result.block.number ?? 0n).toString(),
            success: failedIndex < 0,
            gasUsed: gasUsed.toString(),
            assetChanges: traceAssetChanges ? deltasFrom(result.assetChanges, request.chainId) : [],
            tracedAssets: traceAssetChanges,
            ...(failed?.error ? { revertReason: reasonOf(failed.error) } : {}),
            ...(failedIndex >= 0 ? { failedCall: failedIndex + 1 } : {}),
          }
          return {
            provider: BASELINE_PROVIDER,
            ...conclusions,
            ranAt: now().toISOString(),
            raw: {
              resultHash: resultHashOf(conclusions),
              baseFeePerGas: result.block.baseFeePerGas?.toString() ?? null,
              perCall: result.results.map((r) => ({ status: r.status, gasUsed: (r.gasUsed ?? 0n).toString() })),
            },
          }
        } catch (err) {
          // The method itself is missing: no retry will find it, so drop a
          // layer. A refused trace is worth exactly one retry without it.
          if (unsupported(err)) return await legacy(client, request, now)
          // The chain refused to execute the batch at all — no gas for it, a
          // value it does not have. That is a finding, not a read failure:
          // the plan cannot execute, and the review page has to say so.
          const refusal = executionRefusal(err)
          if (refusal) return await refusedRun(client, request, refusal, now)
          if (traceAssetChanges) continue
          throw new RpcReadError(request.chainId, err)
        }
      }
      throw new RpcReadError(request.chainId, new Error('simulation produced no result'))
    },
  }
}

/** `eth_call` and `eth_estimateGas`, for a node that has never heard of eth_simulateV1. */
async function legacy(
  client: ReturnType<typeof createPublicClient>,
  request: SimulationRequest,
  now: () => Date,
): Promise<SimulationRun> {
  const account = parseAccountId(request.account).address as Hex
  const blockNumber = await client.getBlockNumber()
  let gasUsed = 0n
  for (const [index, call] of request.calls.entries()) {
    const to = parseAccountId(call.to).address as Hex
    const params = {
      account,
      to,
      value: BigInt(call.value),
      blockNumber,
      ...(call.data && call.data !== '0x' ? { data: call.data as Hex } : {}),
    } as const
    try {
      await client.call(params)
      gasUsed += await client.estimateGas(params)
    } catch (err) {
      const conclusions = {
        chainId: request.chainId,
        blockNumber: blockNumber.toString(),
        success: false,
        gasUsed: gasUsed.toString(),
        assetChanges: [],
        tracedAssets: false,
        revertReason: reasonOf(err),
        failedCall: index + 1,
      }
      return { provider: LEGACY_PROVIDER, ...conclusions, ranAt: now().toISOString(), raw: { resultHash: resultHashOf(conclusions) } }
    }
  }
  const conclusions = {
    chainId: request.chainId,
    blockNumber: blockNumber.toString(),
    success: true,
    gasUsed: gasUsed.toString(),
    assetChanges: [],
    tracedAssets: false,
  }
  return { provider: LEGACY_PROVIDER, ...conclusions, ranAt: now().toISOString(), raw: { resultHash: resultHashOf(conclusions) } }
}

export const LEGACY_PROVIDER = 'eth_call'

/**
 * The batch could not be executed as a batch. Distinct from a revert inside a
 * call: nothing ran, so there is no gas figure and no balance to diff, and
 * the reason is the chain's own words about the account.
 */
async function refusedRun(
  client: ReturnType<typeof createPublicClient>,
  request: SimulationRequest,
  revertReason: string,
  now: () => Date,
): Promise<SimulationRun> {
  const blockNumber = await client.getBlockNumber().catch(() => 0n)
  const conclusions = {
    chainId: request.chainId,
    blockNumber: blockNumber.toString(),
    success: false,
    gasUsed: '0',
    assetChanges: [],
    tracedAssets: false,
    revertReason,
  }
  return { provider: BASELINE_PROVIDER, ...conclusions, ranAt: now().toISOString(), raw: { resultHash: resultHashOf(conclusions) } }
}

/**
 * The chain saying this cannot execute, as opposed to the node being unable
 * to answer. Matched on the execution client's own phrasings, which are
 * stable across geth, erigon and the OP and BNB forks of them.
 */
export function executionRefusal(err: unknown): string | null {
  const text = messageOf(err).toLowerCase()
  if (text.includes('insufficient funds')) {
    return 'the account cannot cover the amount plus gas on this chain'
  }
  if (text.includes('nonce too low') || text.includes('nonce too high')) return 'the account nonce has moved'
  if (text.includes('intrinsic gas too low')) return 'the call needs more gas than it was given'
  if (text.includes('exceeds block gas limit') || text.includes('gas limit')) {
    return 'the batch needs more gas than a block allows'
  }
  return null
}

/** Every line the error carries, for matching only — never for showing. */
function messageOf(err: unknown): string {
  const e = err as { name?: string; details?: string; shortMessage?: string; message?: string; cause?: unknown }
  const own = [e?.name, e?.details, e?.shortMessage, e?.message].filter(Boolean).join(' ')
  const cause = e?.cause && e.cause !== err ? messageOf(e.cause) : ''
  return `${own} ${cause}`
}

/** The node does not implement the method, as opposed to the call reverting. */
function unsupported(err: unknown): boolean {
  const text = `${(err as { name?: string })?.name ?? ''} ${(err as { details?: string })?.details ?? ''} ${
    (err as { shortMessage?: string })?.shortMessage ?? ''
  }`.toLowerCase()
  return (
    text.includes('method not found') ||
    text.includes('not supported') ||
    text.includes('unsupported method') ||
    text.includes('does not exist') ||
    text.includes('methodnotfound')
  )
}

/**
 * Why it reverted, in one line, with the request never in it.
 *
 * viem's full message prints the RPC URL, and with a provider template that
 * URL carries the API key — the same reason RpcReadError exists. Anything
 * that still looks like a URL is dropped rather than trimmed: a reason is a
 * nicety, and a leaked key is not worth one.
 */
export function reasonOf(err: unknown, limit = 200): string {
  const refusal = executionRefusal(err)
  if (refusal) return refusal
  const e = err as { shortMessage?: string; details?: string; name?: string }
  // viem puts the contract's own revert string on the line after its
  // "reverted with the following reason:" lead-in, so the first line alone
  // throws away the only part worth reading.
  const lines = (e?.shortMessage ?? e?.details ?? e?.name ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
  const said = lines.find((line) => !line.endsWith(':') && !/^the contract function/i.test(line))
  const clean = said ?? (lines.length > 0 ? 'the call reverted without giving a reason' : 'the call reverted')
  if (clean.includes('://')) return 'the call reverted'
  return clean.length > limit ? `${clean.slice(0, limit - 1)}…` : clean
}
