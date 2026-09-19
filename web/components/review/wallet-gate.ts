import { addressOf } from '@/lib/format'

/**
 * Whether the connected wallet is the one the plan named, on the chain the
 * plan runs on. Pure, so the decision is testable without Privy: the panel
 * feeds it what the wallet library reports and renders what comes back.
 *
 * The gate is a hard rule, not a nudge. A plan is bound to one account and one
 * chain by its hash; signing from another account would execute the same
 * calls from a different wallet, and on another chain they would hit whatever
 * lives at those addresses there.
 */
export interface ConnectedAccount {
  address: string
  /** CAIP-2 the wallet is currently on, as Privy reports it. */
  chainId: string
}

export type Gate =
  | { kind: 'connect'; wanted: string }
  | { kind: 'wrong_account'; wanted: string; connected: string }
  | { kind: 'wrong_chain'; wanted: string; chain: string; on: string }
  | { kind: 'ready'; address: string; chain: string }

export function gateFor(
  plan: { account: string; chain: string },
  connected: readonly ConnectedAccount[],
): Gate {
  const wanted = addressOf(plan.account).toLowerCase()
  const match = connected.find((c) => c.address.toLowerCase() === wanted)
  if (!match) {
    const other = connected[0]
    return other
      ? { kind: 'wrong_account', wanted, connected: other.address.toLowerCase() }
      : { kind: 'connect', wanted }
  }
  if (match.chainId.toLowerCase() !== plan.chain.toLowerCase()) {
    return { kind: 'wrong_chain', wanted, chain: plan.chain, on: match.chainId }
  }
  return { kind: 'ready', address: wanted, chain: plan.chain }
}
