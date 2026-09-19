import { createPublicClient, custom, toHex } from 'viem'
import type { PlanCall } from '@/lib/api'
import { addressOf } from '@/lib/format'

/**
 * Handing the plan's calls to the wallet, and nothing else.
 *
 * EIP-5792 first: `wallet_getCapabilities` says whether the wallet batches on
 * this chain, and `wallet_sendCalls` sends the whole plan as one request.
 * Otherwise one `eth_sendTransaction` per call, in order — and only when the
 * caller says partial completion is safe, which for a single transfer it
 * always is and for a plan with an approval is not.
 *
 * This module never sees a key. It asks the provider the wallet gave us, and
 * the wallet asks the person.
 */

export interface Eip1193 {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>
}

export interface SendInput {
  provider: Eip1193
  from: string
  /** CAIP-2 of the plan. */
  chainId: string
  calls: readonly PlanCall[]
  /** True when sending the calls one by one could not leave a dangling approval. */
  sequentialIsSafe: boolean
}

export type SendMethod = 'sendCalls' | 'sequential'

export interface Sent {
  txHash: `0x${string}`
  method: SendMethod
}

export class UserRejected extends Error {}
export class UnsafeFallback extends Error {}
/**
 * The wallet accepted the batch and then we lost sight of it. The calls may
 * be on chain; they must never be sent again. Carries the batch id so the
 * person can be told what to look for.
 */
export class BatchAccepted extends Error {
  constructor(readonly batchId: string, message: string) {
    super(message)
  }
}

const hexChain = (caip2: string) => `0x${Number(caip2.split(':')[1]).toString(16)}`

export function isUserRejection(err: unknown): boolean {
  const e = err as { code?: number; message?: string } | null
  return e?.code === 4001 || /user (rejected|denied)|rejected the request/i.test(e?.message ?? '')
}

/** "Method not found" and "unsupported", in the shapes wallets actually send. */
function isUnsupported(err: unknown): boolean {
  const e = err as { code?: number; message?: string } | null
  return e?.code === 4200 || e?.code === -32601 || e?.code === -32603 || /not supported|unsupported|not found/i.test(e?.message ?? '')
}

/** Whether the wallet batches on this chain. Any failure reads as no. */
export async function supportsSendCalls(provider: Eip1193, from: string, chainId: string): Promise<boolean> {
  try {
    const caps = (await provider.request({ method: 'wallet_getCapabilities', params: [from, [hexChain(chainId)]] })) as
      | Record<string, { atomic?: { status?: string }; atomicBatch?: { supported?: boolean } }>
      | undefined
    const forChain = caps?.[hexChain(chainId)] ?? caps?.[String(Number(chainId.split(':')[1]))]
    if (!forChain) return false
    const status = forChain.atomic?.status
    return status === 'supported' || status === 'ready' || forChain.atomicBatch?.supported === true
  } catch {
    return false
  }
}

const POLL_MS = 1_500
const CALLS_TIMEOUT_MS = 3 * 60_000

/**
 * Submission only. Returns the batch id the wallet handed back; from that
 * moment the calls belong to the wallet and nothing here may send them again.
 */
async function submitBatch(input: SendInput): Promise<string> {
  const { provider, from, chainId, calls } = input
  const result = (await provider.request({
    method: 'wallet_sendCalls',
    params: [
      {
        version: '2.0.0',
        chainId: hexChain(chainId),
        from,
        atomicRequired: false,
        calls: calls.map((c) => ({ to: addressOf(c.to), value: toHex(BigInt(c.value)), data: c.data })),
      },
    ],
  })) as { id?: string } | string
  const id = typeof result === 'string' ? result : result?.id
  if (!id) throw new Error('the wallet accepted the batch but returned no id')
  return id
}

/** Watch an accepted batch until it names a transaction. Never resends. */
async function awaitBatch(provider: Eip1193, id: string): Promise<`0x${string}`> {
  const started = Date.now()
  while (Date.now() - started < CALLS_TIMEOUT_MS) {
    let status: { status?: number | string; receipts?: { transactionHash?: `0x${string}`; status?: string }[] }
    try {
      status = (await provider.request({ method: 'wallet_getCallsStatus', params: [id] })) as typeof status
    } catch (err) {
      throw new BatchAccepted(id, `Your wallet accepted it, but stopped answering about it: ${(err as Error).message}`)
    }
    const code = typeof status.status === 'string' ? (status.status === 'CONFIRMED' ? 200 : status.status === 'PENDING' ? 100 : 500) : (status.status ?? 100)
    const hash = status.receipts?.[0]?.transactionHash
    if (hash) return hash
    if (code >= 400) throw new BatchAccepted(id, `Your wallet reported the batch failed (${code}).`)
    await new Promise((r) => setTimeout(r, POLL_MS))
  }
  throw new BatchAccepted(id, 'Your wallet accepted it but has not named a transaction yet.')
}

async function sendSequential(input: SendInput): Promise<`0x${string}`> {
  const { provider, from, chainId, calls } = input
  const client = createPublicClient({ transport: custom(provider as never) })
  let last: `0x${string}` | null = null
  for (const [i, call] of calls.entries()) {
    const hash = (await provider.request({
      method: 'eth_sendTransaction',
      params: [{ from, to: addressOf(call.to), value: toHex(BigInt(call.value)), data: call.data, chainId: hexChain(chainId) }],
    })) as `0x${string}`
    last = hash
    // Each call must land before the next is offered: the second may depend
    // on the first, and a person should never be asked to sign step two of a
    // plan whose step one reverted.
    if (i < calls.length - 1) {
      const receipt = await client.waitForTransactionReceipt({ hash, pollingInterval: 2_000, timeout: CALLS_TIMEOUT_MS })
      if (receipt.status !== 'success') throw new Error(`step ${i + 1} reverted; the rest was not sent`)
    }
  }
  if (!last) throw new Error('nothing to send')
  return last
}

export async function sendPlanCalls(input: SendInput): Promise<Sent> {
  if (await supportsSendCalls(input.provider, input.from, input.chainId)) {
    let batchId: string | null = null
    try {
      batchId = await submitBatch(input)
    } catch (err) {
      if (isUserRejection(err)) throw new UserRejected('You declined in your wallet.')
      if (!isUnsupported(err)) throw err
      // Claimed support, then refused the method before accepting anything.
      // Only here is the sequential path still safe: nothing was sent.
    }
    if (batchId !== null) {
      // Accepted. Whatever happens now, the calls are the wallet's and are
      // never offered again through another method.
      return { txHash: await awaitBatch(input.provider, batchId), method: 'sendCalls' }
    }
  }
  if (!input.sequentialIsSafe) {
    throw new UnsafeFallback(
      'This wallet cannot send these calls together, and sending them one by one could leave an approval standing. Use a wallet that supports batching.',
    )
  }
  try {
    return { txHash: await sendSequential(input), method: 'sequential' }
  } catch (err) {
    if (isUserRejection(err)) throw new UserRejected('You declined in your wallet.')
    throw err
  }
}

/** Watches the chain through the wallet's own provider, so no key and no third RPC is involved. */
export async function waitForReceipt(provider: Eip1193, txHash: `0x${string}`): Promise<'success' | 'reverted'> {
  const client = createPublicClient({ transport: custom(provider as never) })
  const receipt = await client.waitForTransactionReceipt({ hash: txHash, pollingInterval: 2_000, timeout: 10 * 60_000 })
  return receipt.status === 'success' ? 'success' : 'reverted'
}
