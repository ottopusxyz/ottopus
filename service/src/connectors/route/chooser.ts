import { parseAssetId } from '../../core/index.js'
import { RouteError, type RouteConnector, type RouteErrorCode, type RouteQuote, type RouteRequest } from './types.js'

/**
 * One connector in front of several, in order of preference.
 *
 * A pair is offered to the first provider that serves it; if that one finds
 * no route, or cannot be reached, the next is asked, and so on down the
 * list. The quote that comes back names the provider that made it, so the
 * plan records who actually routed and never the chooser.
 *
 * Preference, not merit: the list is an ordering the deployment sets, and
 * the connector does not compare quotes. Asking every provider and picking
 * the best price is a different product with a different latency, and it
 * would make the review page's route a race result rather than a decision
 * a person can follow.
 *
 * When every provider that serves the pair fails, the reasons are joined,
 * each with the provider's name in front, under the code that says the
 * most: a route that was looked for and not found outranks a provider that
 * was down, which outranks a pair nobody claimed.
 */
export function chooser(providers: readonly RouteConnector[]): RouteConnector {
  if (providers.length === 0) throw new Error('a route chooser needs at least one provider')
  const name = providers.map((p) => p.name).join(', ')

  return {
    name,

    serves(fromChain, toChain) {
      return providers.some((p) => p.serves(fromChain, toChain))
    },

    async route(request: RouteRequest): Promise<RouteQuote> {
      const fromChain = chainOf(request.fromAsset)
      const toChain = chainOf(request.toAsset)
      const failures: { name: string; error: RouteError }[] = []
      for (const provider of providers) {
        if (!provider.serves(fromChain, toChain)) continue
        try {
          return await provider.route(request)
        } catch (err) {
          // A provider's own refusal is a reason to ask the next. Anything
          // else is a bug, and stays one.
          if (!(err instanceof RouteError)) throw err
          failures.push({ name: provider.name, error: err })
        }
      }
      if (failures.length === 0) {
        throw new RouteError('unsupported', `no route provider (${name}) routes between these chains`)
      }
      if (failures.length === 1) throw failures[0]!.error
      throw new RouteError(
        worstOf(failures.map((f) => f.error.code)),
        failures.map((f) => `${f.name}: ${f.error.message}`).join('; '),
      )
    },
  }
}

const chainOf = (assetId: string) => {
  const { namespace, reference } = parseAssetId(assetId)
  return `${namespace}:${reference}`
}

const RANK: Record<RouteErrorCode, number> = { no_route: 2, provider_failed: 1, unsupported: 0 }

function worstOf(codes: readonly RouteErrorCode[]): RouteErrorCode {
  return codes.reduce((best, code) => (RANK[code] > RANK[best] ? code : best), 'unsupported' as RouteErrorCode)
}
