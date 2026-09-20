import { encodeFunctionData, maxUint160, zeroAddress } from 'viem'
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
 * Uniswap's Trading API, the second route provider.
 *
 * Where LI.FI is an aggregator that asks every venue, this asks one: the
 * pools Uniswap itself runs, on the chains it runs them on. For a pair with a
 * deep Uniswap pool that is the direct route — one hop on a known contract,
 * no aggregator fee in the middle — and it is the route a person can most
 * easily recognise on the review page. It answers for about twenty chains,
 * so `serves()` is a list, and whichever provider sits behind it in the
 * chooser takes the rest.
 *
 * Two calls per route: `/quote` for the price and `/swap` for the unsigned
 * transaction. The API would also simulate the swap for us, and is told not
 * to, for the same reason LI.FI is: the routing vendor is not the
 * simulation vendor.
 *
 * **The allowance is Permit2's, and it is made of calls.** The Universal
 * Router pulls a token through Permit2, and the API's own flow wants an
 * unlimited ERC-20 approval to Permit2 plus an off-chain permit signature —
 * neither of which fits a plan: approvals are exact, and a plan is calls a
 * wallet sends, not a signature a filler carries. So the connector builds
 * the allowance itself, as Permit2 also allows: an exact approval of the
 * token to Permit2, then Permit2's own `approve` letting the router draw
 * that exact amount until a deadline. Both are ordinary transactions, both
 * are exact, and the second expires with the plan. A bridge goes to the
 * bridge's own contract, which pulls the token directly, so that one is a
 * plain approval like LI.FI's.
 *
 * **Only routes that are one transaction are routes here.** The API's
 * UniswapX modes return an order for a filler to execute against a
 * signature, and a chained route is several transactions on more than one
 * chain. `protocols` is pinned to the AMM versions so those are never asked
 * for, and any of them coming back regardless is refused rather than
 * half-handled.
 */

export interface UniswapOptions {
  /** Required. The API does not answer without one. */
  apiKey: string
  baseUrl?: string
  fetch?: typeof fetch
  timeoutMs?: number
  now?: () => Date
  /** How long a quote is treated as good for. The API gives no expiry; see LI.FI's note. */
  quoteTtlMs?: number
  /**
   * How long the Permit2 grant to the router stands. Longer than the quote,
   * because a person may sign the approval, be slow with the swap, and
   * still expect it to go through; short enough that what is left after an
   * abandoned plan dies on its own.
   */
  grantTtlMs?: number
}

export const UNISWAP_PROVIDER = 'uniswap'
const UNISWAP_URL = 'https://trade-api.gateway.uniswap.org/v1'
const DEFAULT_TTL_MS = 3 * 60_000
const DEFAULT_GRANT_TTL_MS = 30 * 60_000
const DEFAULT_SLIPPAGE_BPS = 50

/** The canonical Permit2, deployed at the same address on every chain Uniswap serves. */
export const PERMIT2_ADDRESS = '0x000000000022d473030f116ddee9f6b43ac78ba3'

/**
 * The mainnets the API accepts, by EVM id. This is the API's own list, read
 * from its validation error on 2026-09-13; testnets left out. A chain not
 * here is declined by `serves()` so the chooser never asks.
 */
export const UNISWAP_CHAINS: ReadonlySet<number> = new Set([
  1, 10, 56, 130, 137, 143, 196, 324, 480, 1868, 4217, 4326, 4663, 5042, 8453, 42161, 42220, 43114, 57073, 59144, 81457,
  7777777,
])

/** The AMM versions. Never the UniswapX ones: those are orders, not transactions. */
const PROTOCOLS = ['V2', 'V3', 'V4'] as const

/** The routing modes that come back as one transaction on the source chain. */
const TRANSACTION_ROUTINGS = new Set(['CLASSIC', 'BRIDGE', 'WRAP', 'UNWRAP'])

/** The API names the chain's own currency by the zero address, as LI.FI does. */
const tokenAddressOf = (assetId: string) =>
  isNativeAsset(assetId) ? zeroAddress : `0x${parseAssetId(assetId).assetReference.replace(/^0x/, '')}`

interface UniswapQuote {
  requestId?: string
  routing?: string
  permitData?: { values?: { spender?: string } } | null
  quote?: {
    chainId?: number
    input?: { amount?: string }
    output?: { amount?: string; minimumAmount?: string; recipient?: string }
    gasFeeUSD?: string
    routeString?: string
    estimatedFillTimeMs?: number
  }
}

interface UniswapSwap {
  swap?: { to?: string; data?: string; value?: string; chainId?: number }
}

interface UniswapFailure {
  errorCode?: string
  detail?: string
}

export function uniswapConnector(options: UniswapOptions): RouteConnector {
  const doFetch = options.fetch ?? fetch
  const baseUrl = options.baseUrl ?? UNISWAP_URL
  const timeout = options.timeoutMs ?? 12_000
  const now = options.now ?? (() => new Date())
  const ttl = options.quoteTtlMs ?? DEFAULT_TTL_MS
  const grantTtl = options.grantTtlMs ?? DEFAULT_GRANT_TTL_MS

  const serves = (fromChain: string, toChain: string) =>
    [fromChain, toChain].every((c) => {
      if (parseChainId(c).namespace !== 'eip155' || findChain(c) === null) return false
      return UNISWAP_CHAINS.has(toEvmChainId(c))
    })

  async function post<T>(path: string, body: unknown): Promise<T> {
    let res: Response
    try {
      res = await doFetch(`${baseUrl}${path}`, {
        method: 'POST',
        headers: { accept: 'application/json', 'content-type': 'application/json', 'x-api-key': options.apiKey },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeout),
      })
    } catch (err) {
      throw new RouteError('provider_failed', `${UNISWAP_PROVIDER} could not be reached: ${nameOf(err)}`)
    }
    if (res.ok) return (await res.json()) as T
    // The provider's own words, never its URL or the key that went with it.
    const failure = await res.json().catch(() => ({}) as UniswapFailure) as UniswapFailure
    if (res.status === 404) {
      throw new RouteError('no_route', `${UNISWAP_PROVIDER} found no route for this pair at this size${detailIn(failure)}`)
    }
    if (res.status === 401 || res.status === 403) {
      throw new RouteError('provider_failed', `${UNISWAP_PROVIDER} refused the API key`)
    }
    throw new RouteError('provider_failed', `${UNISWAP_PROVIDER} answered ${res.status}${detailIn(failure)}`)
  }

  return {
    name: UNISWAP_PROVIDER,
    serves,

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
      const toChain = `${to.namespace}:${to.reference}`
      if (!serves(fromChain, toChain)) {
        throw new RouteError('unsupported', `${UNISWAP_PROVIDER} does not route on ${chainName(fromChain)}`)
      }
      const signer = parseAccountId(request.fromAccount)
      // The API sends the output to the signer. Asking it to send elsewhere
      // is not something this connector claims to do.
      if (request.toAccount && parseAccountId(request.toAccount).address !== signer.address) {
        throw new RouteError('unsupported', `${UNISWAP_PROVIDER} sends the output to the signing wallet only`)
      }
      const amountIn = BigInt(request.amountIn)
      if (amountIn > maxUint160) {
        throw new RouteError('unsupported', 'the amount is larger than a Permit2 allowance can hold')
      }

      const quoted = await post<UniswapQuote>('/quote', {
        type: 'EXACT_INPUT',
        amount: request.amountIn,
        tokenInChainId: toEvmChainId(fromChain),
        tokenOutChainId: toEvmChainId(toChain),
        tokenIn: tokenAddressOf(request.fromAsset),
        tokenOut: tokenAddressOf(request.toAsset),
        swapper: signer.address,
        slippageTolerance: (request.slippageBps ?? DEFAULT_SLIPPAGE_BPS) / 100,
        protocols: PROTOCOLS,
      })

      const routing = quoted.routing ?? 'unknown'
      if (!TRANSACTION_ROUTINGS.has(routing)) throw new RouteError('unsupported', refusal(routing))
      const output = quoted.quote?.output
      if (!quoted.quote || !output?.amount || !output.minimumAmount) {
        throw new RouteError('provider_failed', `${UNISWAP_PROVIDER} returned a quote with no output`)
      }

      // The transaction, with the router told not to simulate it. See above.
      const built = await post<UniswapSwap>('/swap', { quote: quoted.quote, simulateTransaction: false })
      const tx = built.swap
      if (!tx?.to || !tx.data) {
        throw new RouteError('provider_failed', `${UNISWAP_PROVIDER} returned a quote with no transaction to sign`)
      }
      if (tx.chainId !== undefined && tx.chainId !== toEvmChainId(fromChain)) {
        throw new RouteError('provider_failed', `${UNISWAP_PROVIDER} built the transaction for chain ${tx.chainId}, not ${chainName(fromChain)}`)
      }
      // When the API names the contract that will draw the token, it has to
      // be the one the transaction calls. Anything else is an allowance to a
      // stranger, which is what the policy exists to refuse.
      const permitSpender = quoted.permitData?.values?.spender
      if (permitSpender && permitSpender.toLowerCase() !== tx.to.toLowerCase()) {
        throw new RouteError('provider_failed', `${UNISWAP_PROVIDER} named a spender other than the contract it calls`)
      }

      const chain = parseChainId(fromChain)
      const router = accountOn(chain, tx.to)
      const value = BigInt(tx.value ?? '0').toString()
      const nativeIn = isNativeAsset(request.fromAsset)
      const calls: Call[] = []
      let approval: RouteQuote['approval'] = null

      if (!nativeIn && routing === 'CLASSIC') {
        // Through Permit2: the token to Permit2, then Permit2 to the router,
        // both for exactly what goes in, the second until the grant's deadline.
        const token = accountOn(chain, from.assetReference)
        const permit2 = accountOn(chain, PERMIT2_ADDRESS)
        const expiration = Math.floor((now().getTime() + grantTtl) / 1000)
        approval = { spender: router, asset: request.fromAsset, amount: request.amountIn, through: permit2 }
        calls.push(approveCall(token, PERMIT2_ADDRESS, amountIn, fromChain), {
          to: permit2,
          value: '0',
          data: encodeFunctionData({
            abi: KNOWN_ABI,
            functionName: 'approve',
            args: [`0x${from.assetReference.replace(/^0x/, '')}` as `0x${string}`, tx.to as `0x${string}`, amountIn, expiration],
          }).toLowerCase(),
          chainId: fromChain,
        })
      } else if (!nativeIn && routing === 'BRIDGE') {
        // The bridge contract pulls the token itself.
        approval = { spender: router, asset: request.fromAsset, amount: request.amountIn }
        calls.push(approveCall(accountOn(chain, from.assetReference), tx.to, amountIn, fromChain))
      }
      // An unwrap is a call on the wrapped token itself, and needs no allowance.
      calls.push({ to: router, value, data: tx.data.toLowerCase(), chainId: fromChain })

      const eta = quoted.quote.estimatedFillTimeMs
      return {
        provider: UNISWAP_PROVIDER,
        calls,
        expectedOut: output.amount,
        minOut: output.minimumAmount,
        approval,
        nativeFee: !nativeIn && value !== '0' ? value : null,
        feesUsd: totalUsd([{ amountUSD: quoted.quote.gasFeeUSD }]),
        expiresAt: new Date(now().getTime() + ttl).toISOString(),
        etaSeconds: routing === 'BRIDGE' && typeof eta === 'number' ? Math.max(1, Math.round(eta / 1000)) : null,
        steps: stepWords(routing, quoted.quote.routeString, fromChain, toChain),
        raw: { quote: quoted, swap: built },
      }
    },
  }
}

function approveCall(token: string, spender: string, amount: bigint, chainId: string): Call {
  return {
    to: token,
    value: '0',
    data: encodeFunctionData({
      abi: KNOWN_ABI,
      functionName: 'approve',
      args: [spender as `0x${string}`, amount],
    }).toLowerCase(),
    chainId,
  }
}

/** Why a routing mode is not a route here, in a sentence the agent can pass on. */
function refusal(routing: string): string {
  switch (routing) {
    case 'DUTCH_V2':
    case 'DUTCH_V3':
    case 'PRIORITY':
    case 'DUTCH_LIMIT':
      return `${UNISWAP_PROVIDER} offered a UniswapX order, which a filler executes against a signature; a plan is a transaction you sign yourself`
    case 'CHAINED':
      return `${UNISWAP_PROVIDER} offered a chained route of several transactions across chains; a plan is one signature set on one chain`
    default:
      return `${UNISWAP_PROVIDER} offered a ${routing} route, which is not a transaction to sign`
  }
}

/**
 * The route in words. The API describes a swap as a route string —
 * "[v3] 100.00% = [0.01%] 0xb4CB…" — from which the pool versions are the
 * part a person recognises; a wrap and a bridge are named for what they do.
 */
function stepWords(routing: string, routeString: string | undefined, fromChain: string, toChain: string): string[] {
  const native = findChain(fromChain)?.nativeCurrency.symbol ?? 'the chain’s own currency'
  switch (routing) {
    case 'BRIDGE':
      return [`Bridge to ${chainName(toChain)}`]
    case 'WRAP':
      return [`Wrap ${native}`]
    case 'UNWRAP':
      return [`Unwrap to ${native}`]
    default: {
      const versions = [...new Set((routeString ?? '').match(/\[v[234]\]/gi)?.map((v) => v.slice(1, -1).toLowerCase()) ?? [])].sort()
      return [versions.length === 0 ? 'Swap on Uniswap' : `Swap on Uniswap ${versions.join(' and ')}`]
    }
  }
}

/** Everything the route costs beyond the transaction itself, to the cent. */
function totalUsd(costs: readonly { amountUSD?: string | undefined }[]): string | null {
  const cents = costs.reduce((sum, cost) => {
    const value = Number(cost.amountUSD ?? '0')
    return sum + (Number.isFinite(value) ? Math.round(value * 100) : 0)
  }, 0)
  if (cents <= 0) return null
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`
}

/** The provider's reason, when it gave one, with nothing that looks like a request in it. */
function detailIn(failure: UniswapFailure): string {
  const clean = (failure.detail ?? '').split('\n')[0]?.trim() ?? ''
  if (!clean || clean.includes('://')) return ''
  return `: ${clean.length > 160 ? `${clean.slice(0, 159)}…` : clean}`
}

const nameOf = (err: unknown) => (err instanceof Error ? err.name : 'unknown error')
