import { encodeFunctionData } from 'viem'
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
import { BinanceClient, BinanceError } from '../binance/index.js'
import { RouteError, type RouteConnector, type RouteQuote, type RouteRequest } from './types.js'

/**
 * Binance's Trading API, the third route provider, for same-chain swaps on
 * the chains it is configured for — BNB Chain to begin with.
 *
 * An aggregator like LI.FI, asking several venues and answering with the
 * best; on BNB Chain that includes the venues where tokenized stocks have
 * their liquidity, which is what earns it the first ask there. Never a
 * bridge: the API does not cross chains, and `serves()` says so.
 *
 * Two calls per route, back to back: `/quote` for the routes and their ids,
 * `/swap` for the unsigned transaction behind the best one. A quote id lives
 * about thirty seconds, which is why the two are never held apart — but
 * that clock gates only the second call. Once the transaction is built, the
 * floor is in its calldata (`minReceiveAmount`), and a person may take the
 * usual few minutes to read it. Same treatment as most DEX APIs, which
 * give no expiry at all.
 *
 * **Only routes that are one transaction are routes here.** Equity tokens
 * can come back in RFQ mode — an EIP-712 order a vendor fills against a
 * signature, submitted through the API — and that is neither a transaction
 * a wallet sends nor something Ottopus may broadcast. RFQ is refused as
 * unsupported, so the chooser asks the next provider. Live, both a bStock
 * and an Ondo token quoted as plain SWAP, so today this costs nothing.
 *
 * **The approval is ours.** The quote names the contract that will draw the
 * token (`approveTarget`); the connector encodes an exact ERC-20 approval to
 * it for what goes in, and refuses a build whose transaction calls anything
 * else. Never the API's own approve builder, never unlimited.
 *
 * Nothing here broadcasts. The API has an endpoint for that; it is not used.
 */

export interface BinanceRouteOptions {
  /** The signed client, shared with every other Binance connector. */
  client: BinanceClient
  /** CAIP-2 chains this provider is asked for. Same chain only; the default is BNB Chain. */
  chains?: readonly string[]
  now?: () => Date
  /** How long a built route is treated as good for. See the note on the quote id. */
  quoteTtlMs?: number
}

export const BINANCE_PROVIDER = 'binance'
export const DEFAULT_BINANCE_ROUTE_CHAINS: readonly string[] = ['eip155:56']
const DEFAULT_TTL_MS = 3 * 60_000
const DEFAULT_SLIPPAGE_BPS = 50

/** The API names the chain's own currency by this address, not by zero. */
const NATIVE_TOKEN = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE'

/** The vendor's code for "we asked every venue and none answered". */
const CODE_NO_QUOTE = 40441

const tokenAddressOf = (assetId: string) =>
  isNativeAsset(assetId) ? NATIVE_TOKEN : `0x${parseAssetId(assetId).assetReference.replace(/^0x/, '')}`

interface TokenWords {
  tokenSymbol?: string
}

interface DexHop {
  dexProtocol?: { dexName?: string; percent?: string }
}

/** One route of the several `/quote` answers with, trimmed to what is read. */
interface BinanceQuoteRoute {
  quoteId?: string
  vendorName?: string
  executionMode?: string
  binanceChainId?: string
  fromTokenAmount?: string
  toTokenAmount?: string
  /** The vendor's fee, in USD by the figures observed; gas is `estimateGasFee`, in units. */
  tradeFee?: string
  approveTarget?: string
  isBest?: boolean
  fromToken?: TokenWords
  toToken?: TokenWords
  dexRouterList?: DexHop[]
}

interface BinanceSwap {
  executionMode?: string
  routerResult?: { toTokenAmount?: string; vendorName?: string; dexRouterList?: DexHop[] }
  tx?: {
    from?: string
    to?: string
    data?: string
    value?: string
    minReceiveAmount?: string
    slippagePercent?: string
  }
  rfq?: unknown
}

export function binanceRouteConnector(options: BinanceRouteOptions): RouteConnector {
  const { client } = options
  const chains = new Set(options.chains ?? DEFAULT_BINANCE_ROUTE_CHAINS)
  const now = options.now ?? (() => new Date())
  const ttl = options.quoteTtlMs ?? DEFAULT_TTL_MS

  const serves = (fromChain: string, toChain: string) =>
    fromChain === toChain &&
    chains.has(fromChain) &&
    parseChainId(fromChain).namespace === 'eip155' &&
    findChain(fromChain) !== null

  return {
    name: BINANCE_PROVIDER,
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
        throw new RouteError(
          'unsupported',
          fromChain === toChain
            ? `${BINANCE_PROVIDER} does not route on ${chainName(fromChain)}`
            : `${BINANCE_PROVIDER} does not bridge; it swaps on one chain at a time`,
        )
      }
      const signer = parseAccountId(request.fromAccount)
      // The API sends the output to the wallet that signs. Asking it to send
      // elsewhere is not something this connector claims to do.
      if (request.toAccount && parseAccountId(request.toAccount).address !== signer.address) {
        throw new RouteError('unsupported', `${BINANCE_PROVIDER} sends the output to the signing wallet only`)
      }

      const common = {
        binanceChainId: String(toEvmChainId(fromChain)),
        amount: request.amountIn,
        fromTokenAddress: tokenAddressOf(request.fromAsset),
        toTokenAddress: tokenAddressOf(request.toAsset),
        userWalletAddress: signer.address,
      }

      const routes = await ask<BinanceQuoteRoute[] | BinanceQuoteRoute>('/api/v1/dex/aggregator/quote', common)
      const offered = (Array.isArray(routes) ? routes : [routes]).filter((r) => r && typeof r === 'object')
      if (offered.length === 0) {
        throw new RouteError('no_route', `${BINANCE_PROVIDER} found no route for this pair at this size`)
      }
      // A non-SWAP quote (RFQ) can still be marked isBest; that must not hide
      // a usable SWAP quote sitting alongside it in the same response.
      const swapRoutes = offered.filter((r) => r.executionMode === 'SWAP')
      if (swapRoutes.length === 0) {
        const overallBest = offered.find((r) => r.isBest) ?? offered[0]
        throw new RouteError('unsupported', refusal(overallBest?.executionMode))
      }
      const best = swapRoutes.find((r) => r.isBest) ?? swapRoutes[0]
      if (!best?.quoteId) {
        throw new RouteError('no_route', `${BINANCE_PROVIDER} found no route for this pair at this size`)
      }
      if (!best.toTokenAmount) {
        throw new RouteError('provider_failed', `${BINANCE_PROVIDER} returned a quote with no output`)
      }

      // Straight away, while the quote id is still good.
      const built = await ask<BinanceSwap>('/api/v1/dex/aggregator/swap', {
        ...common,
        quoteId: best.quoteId,
        slippagePercent: slippagePercentOf(request.slippageBps ?? DEFAULT_SLIPPAGE_BPS),
      })
      if (!built || typeof built !== 'object') {
        throw new RouteError('provider_failed', `${BINANCE_PROVIDER} returned no transaction to build`)
      }
      if (built.executionMode !== undefined && built.executionMode !== 'SWAP') {
        throw new RouteError('unsupported', refusal(built.executionMode))
      }
      const tx = built.tx
      if (!tx?.to || !tx.data) {
        throw new RouteError('provider_failed', `${BINANCE_PROVIDER} returned a quote with no transaction to sign`)
      }
      if (!tx.minReceiveAmount) {
        throw new RouteError('provider_failed', `${BINANCE_PROVIDER} built a transaction with no floor on what comes out`)
      }
      if (tx.from && tx.from.toLowerCase() !== signer.address.toLowerCase()) {
        throw new RouteError('provider_failed', `${BINANCE_PROVIDER} built the transaction for a different wallet`)
      }

      const chain = parseChainId(fromChain)
      const nativeIn = isNativeAsset(request.fromAsset)
      const amountIn = BigInt(request.amountIn)
      const value = BigInt(tx.value ?? '0').toString()
      const router = accountOn(chain, tx.to)
      const calls: Call[] = []
      let approval: RouteQuote['approval'] = null

      if (!nativeIn) {
        // The contract the quote said would draw the token has to be the one
        // the transaction calls. Anything else is an allowance to a stranger,
        // which is what the policy exists to refuse.
        if (!best.approveTarget) {
          throw new RouteError('provider_failed', `${BINANCE_PROVIDER} named no contract to approve for a token input`)
        }
        if (best.approveTarget.toLowerCase() !== tx.to.toLowerCase()) {
          throw new RouteError('provider_failed', `${BINANCE_PROVIDER} named a spender other than the contract it calls`)
        }
        approval = { spender: router, asset: request.fromAsset, amount: request.amountIn }
        calls.push({
          to: accountOn(chain, from.assetReference),
          value: '0',
          data: encodeFunctionData({
            abi: KNOWN_ABI,
            functionName: 'approve',
            args: [tx.to as `0x${string}`, amountIn],
          }).toLowerCase(),
          chainId: fromChain,
        })
      } else if (value !== amountIn.toString()) {
        throw new RouteError(
          'provider_failed',
          `${BINANCE_PROVIDER} built a transaction sending ${value} wei, not the ${amountIn} asked for`,
        )
      }
      calls.push({ to: router, value, data: tx.data.toLowerCase(), chainId: fromChain })

      return {
        provider: BINANCE_PROVIDER,
        calls,
        expectedOut: built.routerResult?.toTokenAmount ?? best.toTokenAmount,
        minOut: tx.minReceiveAmount,
        approval,
        // A token route sending native value would be a fee the intent never
        // mentioned; declared so verify can hold the calls to it.
        nativeFee: !nativeIn && value !== '0' ? value : null,
        feesUsd: usdOf(best.tradeFee),
        expiresAt: new Date(now().getTime() + ttl).toISOString(),
        etaSeconds: null,
        steps: stepWords(built.routerResult?.dexRouterList ?? best.dexRouterList, built.routerResult?.vendorName ?? best.vendorName),
        raw: { quote: best, swap: built },
      }
    },
  }

  /** One signed GET, with the vendor's refusals translated into route errors. */
  async function ask<T>(path: string, query: Record<string, string>): Promise<T> {
    try {
      return await client.get<T>(path, query)
    } catch (err) {
      if (!(err instanceof BinanceError)) throw err
      // The provider's own words, never its URL or the key that went with it.
      if (err.code === 'rejected' && err.vendorCode === CODE_NO_QUOTE) {
        throw new RouteError('no_route', `${BINANCE_PROVIDER} found no route for this pair at this size`)
      }
      if (err.code === 'not_configured') {
        throw new RouteError('provider_failed', `${BINANCE_PROVIDER} refused the API key`)
      }
      if (err.code === 'rate_limited') {
        throw new RouteError('provider_failed', `${BINANCE_PROVIDER} is rate limiting; try again shortly`)
      }
      throw new RouteError('provider_failed', `${BINANCE_PROVIDER}: ${firstLine(err.message)}`)
    }
  }
}

/** Basis points as the percentage string the API takes: 50 → "0.5". */
export function slippagePercentOf(bps: number): string {
  const whole = Math.floor(bps / 100)
  const rest = bps % 100
  if (rest === 0) return String(whole)
  return `${whole}.${String(rest).padStart(2, '0').replace(/0$/, '')}`
}

/** Why an execution mode is not a route here, in a sentence the agent can pass on. */
function refusal(mode: string | undefined): string {
  if (mode === 'RFQ') {
    return `${BINANCE_PROVIDER} offered an RFQ order, which a vendor fills against a signature; a plan is a transaction you sign yourself`
  }
  return `${BINANCE_PROVIDER} offered a ${mode ?? 'nameless'} route, which is not a transaction to sign`
}

/**
 * The route in words. The vendor lists the venues it split across; a person
 * recognises the venue, and the aggregator behind it is worth naming once.
 */
function stepWords(hops: DexHop[] | undefined, vendor: string | undefined): string[] {
  const venues = [...new Set((hops ?? []).map((h) => h.dexProtocol?.dexName).filter((n): n is string => Boolean(n)))]
  const via = vendor ? ` via ${vendor}` : ''
  if (venues.length === 0) return [`Swap${via} on Binance`]
  return [`Swap on ${venues.join(' and ')}${via}`]
}

/** A decimal USD figure to the cent, or null when there is none. */
function usdOf(fee: string | undefined): string | null {
  const value = Number(fee ?? '')
  if (!Number.isFinite(value) || value <= 0) return null
  const cents = Math.round(value * 100)
  if (cents <= 0) return '0.01'
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`
}

function firstLine(message: string): string {
  const clean = message.split('\n')[0]?.trim() ?? ''
  if (!clean || clean.includes('://')) return 'the provider refused the request'
  return clean.length > 160 ? `${clean.slice(0, 159)}…` : clean
}
