import { encodeFunctionData, zeroAddress } from 'viem'
import {
  type Call,
  accountOn,
  chainName,
  findChain,
  isNativeAsset,
  parseAccountId,
  parseAssetId,
  parseChainId,
  toEvmChainId,
} from '../../core/index.js'
import { KNOWN_ABI } from '../../verify/index.js'
import { RouteError, type RouteConnector, type RouteQuote, type RouteRequest } from './types.js'

/**
 * LI.FI, the first route provider.
 *
 * Chosen over 1inch, 0x, Socket/Bungee and Rango for the first slice, and the
 * reasons are all about friction rather than routing quality: one endpoint
 * answers both swaps and bridges, keyed on whether the chains match; it works
 * with no API key at all; and it covers 75 EVM mainnets against the handful
 * the same-chain-only providers do. Odos was a candidate until it shut down
 * in July 2026.
 *
 * Two decisions inside this file matter more than the vendor:
 *
 * **`skipSimulation` is always on.** LI.FI simulates the route on `/quote` to
 * refine its gas estimate. Letting it would make the routing vendor a
 * simulation vendor, which is the one thing invariant 4 forbids. Ottopus
 * simulates with `eth_simulateV1`, on its own, and asks LI.FI for a route and
 * nothing else.
 *
 * **The approval is ours, not theirs.** LI.FI returns the spender that needs
 * an allowance but not an amount, so this builds the `approve()` call itself
 * with the exact input amount. That is the better arrangement: the policy
 * demands exact approvals, and a call we encode cannot be an unlimited one
 * however the provider felt about it.
 */

export interface LifiOptions {
  /** Optional. Unauthenticated works; a free key raises the rate limit. */
  apiKey?: string | undefined
  baseUrl?: string
  /** Identifies us to LI.FI, and is how they attribute integrator volume. */
  integrator?: string
  fetch?: typeof fetch
  timeoutMs?: number
  now?: () => Date
  /**
   * How long a quote is treated as good for.
   *
   * LI.FI does not return an expiry, so this is ours and it is a judgement:
   * long enough for somebody to open a link from a chat and sign, short
   * enough that the price is still roughly the one they were shown. The
   * thing that actually protects them is `minOut`, which the route commits
   * to on chain — the clock only decides when to make them ask again.
   */
  quoteTtlMs?: number
}

export const LIFI_PROVIDER = 'lifi'
const LIFI_URL = 'https://li.quest'
const DEFAULT_TTL_MS = 3 * 60_000

/** LI.FI names the chain's own currency by the zero address. */
const tokenAddressOf = (assetId: string) =>
  isNativeAsset(assetId) ? zeroAddress : `0x${parseAssetId(assetId).assetReference.replace(/^0x/, '')}`

interface LifiQuote {
  tool?: string
  estimate?: {
    toAmount?: string
    toAmountMin?: string
    approvalAddress?: string
    feeCosts?: { amountUSD?: string }[]
    gasCosts?: { amountUSD?: string }[]
  }
  includedSteps?: { toolDetails?: { name?: string }; type?: string }[]
  transactionRequest?: { to?: string; data?: string; value?: string; chainId?: number }
}

export function lifiConnector(options: LifiOptions = {}): RouteConnector {
  const doFetch = options.fetch ?? fetch
  const baseUrl = options.baseUrl ?? LIFI_URL
  const timeout = options.timeoutMs ?? 12_000
  const now = options.now ?? (() => new Date())
  const ttl = options.quoteTtlMs ?? DEFAULT_TTL_MS
  const integrator = options.integrator ?? 'ottopus'

  return {
    name: LIFI_PROVIDER,

    serves(fromChain, toChain) {
      // Both EVM and both in our registry. Which of LI.FI's 75 chains this is
      // one of is their answer to give: a pair they do not route comes back
      // as no_route with their own words, which beats a stale list here.
      return [fromChain, toChain].every((c) => parseChainId(c).namespace === 'eip155' && findChain(c) !== null)
    },

    async route(request: RouteRequest): Promise<RouteQuote> {
      if (request.amountOut !== undefined) {
        throw new RouteError(
          'unsupported',
          'this provider quotes by the amount going in, not the amount coming out; give amountIn instead',
        )
      }
      if (request.amountIn === undefined) {
        throw new RouteError('unsupported', 'a route needs the amount going in')
      }
      const from = parseAssetId(request.fromAsset)
      const to = parseAssetId(request.toAsset)
      const fromChain = `${from.namespace}:${from.reference}`
      const signer = parseAccountId(request.fromAccount)

      const params = new URLSearchParams({
        fromChain: String(toEvmChainId(fromChain)),
        toChain: String(toEvmChainId(`${to.namespace}:${to.reference}`)),
        fromToken: tokenAddressOf(request.fromAsset),
        toToken: tokenAddressOf(request.toAsset),
        fromAmount: request.amountIn,
        fromAddress: signer.address,
        toAddress: request.toAccount ? parseAccountId(request.toAccount).address : signer.address,
        integrator,
        // Never let the router simulate for us. See the note above.
        skipSimulation: 'true',
      })
      if (request.slippageBps !== undefined) params.set('slippage', String(request.slippageBps / 10_000))

      let body: LifiQuote
      try {
        const res = await doFetch(`${baseUrl}/v1/quote?${params.toString()}`, {
          headers: { accept: 'application/json', ...(options.apiKey ? { 'x-lifi-api-key': options.apiKey } : {}) },
          signal: AbortSignal.timeout(timeout),
        })
        if (res.status === 404) {
          throw new RouteError('no_route', `${LIFI_PROVIDER} found no route for this pair at this size`)
        }
        if (!res.ok) {
          // The provider's own words, never its URL: a key would be in it.
          const detail = await res.text().catch(() => '')
          throw new RouteError('provider_failed', `${LIFI_PROVIDER} answered ${res.status}${reasonIn(detail)}`)
        }
        body = (await res.json()) as LifiQuote
      } catch (err) {
        if (err instanceof RouteError) throw err
        throw new RouteError('provider_failed', `${LIFI_PROVIDER} could not be reached: ${nameOf(err)}`)
      }

      const tx = body.transactionRequest
      const estimate = body.estimate
      if (!tx?.to || !tx.data || !estimate?.toAmount || !estimate.toAmountMin) {
        throw new RouteError('provider_failed', `${LIFI_PROVIDER} returned a quote with no transaction to sign`)
      }
      const chain = parseChainId(fromChain)
      const calls: Call[] = []

      // The approval, encoded here, for exactly what goes in.
      const approval = !isNativeAsset(request.fromAsset) && estimate.approvalAddress
        ? {
            spender: accountOn(chain, estimate.approvalAddress),
            asset: request.fromAsset,
            amount: request.amountIn,
          }
        : null
      if (approval) {
        calls.push({
          to: accountOn(chain, from.assetReference),
          value: '0',
          data: encodeFunctionData({
            abi: KNOWN_ABI,
            functionName: 'approve',
            args: [approval.spender.split(':')[2] as `0x${string}`, BigInt(request.amountIn)],
          }).toLowerCase(),
          chainId: fromChain,
        })
      }
      calls.push({
        to: accountOn(chain, tx.to),
        value: BigInt(tx.value ?? '0').toString(),
        data: tx.data.toLowerCase(),
        chainId: fromChain,
      })

      return {
        provider: LIFI_PROVIDER,
        calls,
        expectedOut: estimate.toAmount,
        minOut: estimate.toAmountMin,
        approval,
        feesUsd: totalUsd([...(estimate.feeCosts ?? []), ...(estimate.gasCosts ?? [])]),
        expiresAt: new Date(now().getTime() + ttl).toISOString(),
        steps: stepWords(body, fromChain, `${to.namespace}:${to.reference}`),
        raw: body,
      }
    },
  }
}

/**
 * The route in words, one line per hop, for the review page's steps.
 *
 * Only the hops that move the money. LI.FI includes its own fee collection
 * in `includedSteps` as a step of type `protocol`, which came back live as
 * "Swap on Integrator Fee" — a line that tells a person nothing and reads
 * like a venue they have never heard of. The fee is already on the plan as a
 * number; it does not need to be a step as well.
 */
const MOVING_STEPS = new Set(['swap', 'cross'])

function stepWords(body: LifiQuote, fromChain: string, toChain: string): string[] {
  const steps = body.includedSteps ?? []
  const moving = steps.filter((step) => step.type === undefined || MOVING_STEPS.has(step.type))
  const hops = (moving.length > 0 ? moving : steps)
    .map((step) => step.toolDetails?.name)
    .filter((name): name is string => Boolean(name))
  const named = hops.length > 0 ? hops : body.tool ? [body.tool] : []
  if (named.length === 0) return [`Route by ${LIFI_PROVIDER}`]
  const crossing = fromChain !== toChain
  return named.map((name, i) =>
    crossing && i === named.length - 1 ? `Bridge with ${name} to ${chainName(toChain)}` : `Swap on ${name}`,
  )
}

/** Everything the route costs beyond the transaction itself, to the cent. */
function totalUsd(costs: readonly { amountUSD?: string }[]): string | null {
  const cents = costs.reduce((sum, cost) => {
    const value = Number(cost.amountUSD ?? '0')
    return sum + (Number.isFinite(value) ? Math.round(value * 100) : 0)
  }, 0)
  if (cents <= 0) return null
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`
}

/** A short reason from a provider's error body, with nothing that looks like a request in it. */
function reasonIn(body: string): string {
  const message = (() => {
    try {
      const parsed = JSON.parse(body) as { message?: unknown }
      return typeof parsed.message === 'string' ? parsed.message : ''
    } catch {
      return ''
    }
  })()
  const clean = message.split('\n')[0]?.trim() ?? ''
  if (!clean || clean.includes('://')) return ''
  return `: ${clean.length > 160 ? `${clean.slice(0, 159)}…` : clean}`
}

const nameOf = (err: unknown) => (err instanceof Error ? err.name : 'unknown error')
