import { addressOf } from '@/lib/format'

/**
 * Whether the connected wallet is the one the plan named, on the chain the
 * plan runs on. Pure, so the decision is testable without a wallet: the panel
 * feeds it what the connected wallet reports and renders what comes back.
 *
 * The gate is a hard rule, not a nudge. A plan is bound to one account and one
 * chain by its hash; signing from another account would execute the same
 * calls from a different wallet, and on another chain they would hit whatever
 * lives at those addresses there.
 */
export interface ConnectedAccount {
  address: string
  /** CAIP-2 the wallet is currently on, as the wallet reports it. */
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

/** What the wallet strip under the buttons says: one shape for every gate. */
export interface SignerStatus {
  /** `idle` has no wallet; `ok` may sign; `warn` holds a wallet that may not yet. */
  tone: 'idle' | 'ok' | 'warn'
  /** What is connected, or that nothing is. */
  title: string
  /** Where that leaves the plan, and what to do about it. */
  note: string
}

export interface SignerContext {
  /** The plan's account as a person reads it: its label and short address. */
  signerName: string
  /** The plan's account and the connected one, already shortened. */
  wantedShort: string
  connectedShort: string | null
  /** Display names of the plan's chain and the one the wallet is on. */
  chainName: string
  onChainName: string | null
  /** The connected wallet, when there is one. */
  wallet: { name: string; kind: 'installed' | 'walletconnect' | 'sdk' } | null
}

/**
 * The words for each gate. Copy only: the gate has already decided who may
 * sign, and nothing here is consulted for that.
 */
export function signerStatus(gate: Gate, ctx: SignerContext): SignerStatus {
  const walletName = ctx.wallet?.name ?? 'Wallet'
  if (gate.kind === 'connect') {
    return { tone: 'idle', title: 'No wallet connected', note: `This plan signs with ${ctx.signerName}` }
  }
  if (gate.kind === 'ready') {
    return { tone: 'ok', title: `${walletName} · ${ctx.wantedShort}`, note: `Right wallet, on ${ctx.chainName}` }
  }
  if (gate.kind === 'wrong_chain') {
    return {
      tone: 'warn',
      title: `${walletName} · ${ctx.wantedShort}`,
      note: `Right wallet, but on ${ctx.onChainName ?? 'another network'}. This plan runs on ${ctx.chainName}`,
    }
  }
  // A web wallet holds one account per sign-in, so there is nothing to select inside it.
  const fix =
    ctx.wallet?.kind === 'sdk'
      ? `Disconnect, then connect ${ctx.signerName}`
      : `Select ${ctx.signerName} in ${walletName}`
  return { tone: 'warn', title: `${walletName} · ${ctx.connectedShort ?? ''}`, note: `Not this plan's wallet. ${fix}` }
}
