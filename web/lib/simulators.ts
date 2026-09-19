import type { Plan } from './api'

/**
 * Links out to somebody else's tooling, so a reader does not have to take
 * Ottopus's word for what the calldata says.
 *
 * This is the product's own argument applied to itself. The page shows a
 * decoded call and a simulated diff, both produced by us; a person deciding
 * whether to sign should be able to check that reading against a tool with no
 * stake in the answer. One link does that, costs nothing, and needs no
 * account.
 *
 * What is deliberately absent is a rich trace link. Tenderly's simulator can
 * only be prefilled through its drafts API, which needs a paid Tenderly plan
 * on our side and a Tenderly login on the reader's; BlockSec Phalcon has no
 * documented prefill scheme; Blockaid has no public UI at all. None of those
 * belongs in a keyless page, and committing to a paid vendor is not a
 * decision this file gets to make.
 */

/** Where a neutral decoder reads raw calldata. Keyless, no account, no cost. */
const DECODER = 'https://calldata.swiss-knife.xyz/decoder'

/**
 * A third-party decode of the plan's calldata.
 *
 * The first call that carries any — a batch's approval, say, is the one worth
 * a second opinion, and a native transfer has nothing to decode. Null when
 * there is nothing, so the page shows no dead link.
 */
export function decoderUrl(plan: Plan): string | null {
  if (plan.outcome.type !== 'calls') return null
  const call = plan.outcome.calls.find((c) => c.data && c.data !== '0x')
  if (!call) return null
  return `${DECODER}?calldata=${encodeURIComponent(call.data)}`
}
