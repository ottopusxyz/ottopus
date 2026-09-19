'use client'

import { useConnectWallet, useWallets } from '@privy-io/react-auth'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Otto } from '@/components/brand'
import { Button, Dialog } from '@/components/ui'
import type { Plan, WebTransition } from '@/lib/api'
import { addChainParams, chainName, evmIdOf, explorerTxUrl } from '@/lib/chains'
import { addressOf, truncateAddress } from '@/lib/format'
import type { Eip1193 } from '@/lib/simulate'
import { approvals, chainOfPlan } from './model'
import { BatchAccepted, UnsafeFallback, UserRejected, sendPlanCalls, waitForReceipt } from './send-calls'
import { gateFor } from './wallet-gate'

/**
 * The bottom of the card while a plan can still be signed: the gate, then the
 * signature, then the wait for the chain.
 *
 * The gate is the security control. The sign button does not exist until the
 * connected wallet is the account the plan named, on the chain the plan runs
 * on; the page never offers to sign from anything else.
 */
export interface SignPanelProps {
  plan: Plan
  move: (transition: WebTransition) => Promise<unknown>
  /** Whether the plan may still be signed, by the page's own clock. */
  open: boolean
  /** The hash the service holds for a submitted plan, so a reopened page resumes the watch. */
  txHash?: string | null | undefined
  /**
   * Run the browser's simulation again. Called immediately before the wallet
   * is asked to sign: the plan was built minutes ago and the last thing a
   * person should do is send a transaction the chain has already started
   * refusing.
   */
  resimulate?: ((provider?: Eip1193 | null) => Promise<{ success: boolean; revertReason?: string; failedCall?: number } | null>) | undefined
}

type Phase =
  | { kind: 'idle' }
  | { kind: 'switching' }
  | { kind: 'signing' }
  | { kind: 'submitted'; txHash: `0x${string}` }
  | { kind: 'confirmed'; txHash: `0x${string}` }
  | { kind: 'failed'; txHash: `0x${string}` | null; reason: string }

const isHash = (v: unknown): v is `0x${string}` => typeof v === 'string' && /^0x[0-9a-f]{64}$/i.test(v)

export function SignPanel({ plan, move, open, txHash, resimulate }: SignPanelProps) {
  const router = useRouter()
  const { wallets, ready } = useWallets()
  const { connectWallet } = useConnectWallet()
  // A page opened on a plan already submitted starts where the plan is.
  const [phase, setPhase] = useState<Phase>(() =>
    plan.status === 'submitted' && isHash(txHash) ? { kind: 'submitted', txHash } : { kind: 'idle' },
  )
  const watching = useRef(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [confirmCancel, setConfirmCancel] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const wroteAwaiting = useRef(false)

  const chain = chainOfPlan(plan)
  const bound = { account: plan.resolution.account.caip10, chain }
  const wanted = addressOf(bound.account)
  const gate = gateFor(
    bound,
    wallets.map((w) => ({ address: w.address, chainId: w.chainId })),
  )
  const wallet = wallets.find((w) => w.address.toLowerCase() === wanted.toLowerCase())
  const signerName = plan.resolution.account.label
    ? `${plan.resolution.account.label} (${truncateAddress(wanted)})`
    : truncateAddress(wanted)

  // The moment the named wallet is connected on the right chain, the plan is
  // waiting on a signature rather than on a review. Written once.
  useEffect(() => {
    if (!open || gate.kind !== 'ready' || wroteAwaiting.current || plan.status !== 'awaiting_review') return
    wroteAwaiting.current = true
    void move({ status: 'awaiting_signature' }).catch(() => {
      wroteAwaiting.current = false
    })
  }, [open, gate.kind, plan.status, move])

  // Resume the receipt watch for a submitted plan through the named wallet's
  // provider, when that wallet is connected. Without it the page still shows
  // the hash and the explorer; the job (#40) closes the loop server-side.
  useEffect(() => {
    if (phase.kind !== 'submitted' || !wallet || watching.current) return
    watching.current = true
    const hash = phase.txHash
    void (async () => {
      try {
        const provider = await wallet.getEthereumProvider()
        const outcome = await waitForReceipt(provider, hash)
        if (outcome === 'success') {
          await move({ status: 'confirmed' })
          setPhase({ kind: 'confirmed', txHash: hash })
        } else {
          await move({ status: 'failed', detail: { reason: 'reverted' } })
          setPhase({ kind: 'failed', txHash: hash, reason: 'The transaction reverted on chain.' })
        }
      } catch {
        watching.current = false
        setProblem('Lost track of the receipt. The transaction is on chain; check the explorer.')
      }
    })()
  }, [phase, wallet, move])

  const switchChain = useCallback(async () => {
    if (!wallet) return
    const evmId = evmIdOf(chain)
    if (evmId === null) return
    setPhase({ kind: 'switching' })
    setProblem(null)
    try {
      try {
        await wallet.switchChain(evmId)
      } catch (err) {
        // 4902: the wallet has never heard of the chain. Teach it from the
        // registry, then ask again. Anything else is the wallet's answer.
        const code = (err as { code?: number }).code
        if (code !== 4902 && !/unrecognized|not added|4902/i.test(String((err as Error).message))) throw err
        const params = addChainParams(chain)
        if (!params) throw err
        const provider = await wallet.getEthereumProvider()
        await provider.request({ method: 'wallet_addEthereumChain', params: [params] })
        await wallet.switchChain(evmId)
      }
    } catch (err) {
      setProblem(`Could not switch to ${chainName(chain)}: ${(err as Error).message}`)
    } finally {
      setPhase({ kind: 'idle' })
    }
  }, [wallet, chain])

  const sign = useCallback(async () => {
    if (!wallet || gate.kind !== 'ready' || plan.outcome.type !== 'calls') return
    setProblem(null)
    setPhase({ kind: 'signing' })
    let txHash: `0x${string}` | null = null
    try {
      const provider = await wallet.getEthereumProvider()
      // The last check before the wallet opens. A run that cannot answer says
      // nothing and does not stop anybody; one that reverts does, because the
      // alternative is a signature that burns a fee for nothing.
      if (resimulate) {
        const fresh = await resimulate(provider as Eip1193)
        if (fresh && !fresh.success) {
          setPhase({ kind: 'idle' })
          const which = fresh.failedCall ? `Call ${fresh.failedCall}` : 'This batch'
          setProblem(
            `${which} now reverts against the chain${fresh.revertReason ? `: ${fresh.revertReason}` : ''}. ` +
              'Nothing was sent. Ask the agent to prepare it again.',
          )
          return
        }
      }
      const sent = await sendPlanCalls({
        provider,
        from: wanted,
        chainId: chain,
        calls: plan.outcome.calls,
        // One by one is safe only when no call is an approval another depends on.
        sequentialIsSafe: plan.outcome.calls.length === 1 || approvals(plan).length === 0,
      })
      txHash = sent.txHash
      await move({ status: 'submitted', detail: { txHash } })
      // The watch effect takes it from here, for this page and for any reopened one.
      setPhase({ kind: 'submitted', txHash })
    } catch (err) {
      if (err instanceof UserRejected || err instanceof UnsafeFallback) {
        setPhase({ kind: 'idle' })
        setProblem(err.message)
        return
      }
      if (err instanceof BatchAccepted) {
        // Never idle again: idle would offer the sign button, and the calls are
        // already the wallet's. Nothing to write yet either — submitted needs a hash.
        setPhase({ kind: 'failed', txHash: null, reason: `${err.message} Check your wallet's activity before doing anything else; this request was not sent twice.` })
        return
      }
      // Submitted but the wait failed: the chain still has it. Say so rather than
      // calling it failed, and leave the plan as submitted for the job (#40).
      if (txHash) {
        setPhase({ kind: 'submitted', txHash })
        setProblem('Lost track of the receipt. The transaction is on chain; check the explorer.')
        return
      }
      setPhase({ kind: 'idle' })
      setProblem((err as Error).message || 'The wallet did not send it.')
    }
  }, [wallet, gate.kind, plan, wanted, chain, move, resimulate])

  const cancel = useCallback(async () => {
    setCancelling(true)
    try {
      await move({ status: 'cancelled' })
      setConfirmCancel(false)
    } catch (err) {
      setProblem((err as Error).message)
    } finally {
      setCancelling(false)
    }
  }, [move])

  const explorer = (hash: `0x${string}`) => explorerTxUrl(chain, hash)

  if (phase.kind === 'confirmed') {
    return (
      <div className="flex flex-col items-center gap-2.5 text-center">
        <div className="relative flex h-[88px] w-[88px] items-center justify-center">
          <span aria-hidden className="ot-settle-ripple absolute h-16 w-16 rounded-full bg-[var(--ot-navy-soft)]" />
          <div className="relative">
            <Otto pose="confirmed" size={88} label="Otto, arms up" />
          </div>
        </div>
        <span className="font-[family-name:var(--ot-font-display)] text-[19px] font-bold">Signed and settled</span>
        <p className="m-0 text-[12.5px] leading-[1.45] text-[var(--ot-text-2)]">
          {plan.humanPlan.summary}. Confirmed on {chainName(chain)}.
        </p>
        <div className="flex w-full gap-2">
          {explorer(phase.txHash) ? (
            <Button variant="secondary" size="sm" fullWidth onClick={() => window.open(explorer(phase.txHash)!, '_blank', 'noreferrer')}>
              View on the explorer
            </Button>
          ) : null}
          <Button variant="secondary" size="sm" fullWidth onClick={() => router.push('/portfolio')}>
            Back to portfolio
          </Button>
        </div>
      </div>
    )
  }

  if (phase.kind === 'submitted') {
    return (
      <div className="flex flex-col gap-2 rounded-[10px] bg-[var(--ot-card)] px-3 py-[11px]">
        <div className="flex items-center gap-2">
          <span aria-hidden className="ot-ring h-4 w-4 flex-none rounded-full border-2 border-[var(--ot-plan-border)] border-t-[var(--ot-plan)]" />
          <span className="text-[13.5px] font-semibold">Pending confirmation</span>
        </div>
        <p className="m-0 text-[12.5px] leading-[1.45] text-[var(--ot-text-2)]">
          Your wallet sent it. Close this page if you like — the transaction finishes either way.
        </p>
        {explorer(phase.txHash) ? (
          <a href={explorer(phase.txHash)!} target="_blank" rel="noreferrer" className="text-[12px] text-[var(--ot-plan-text)]">
            Follow it on the explorer
          </a>
        ) : null}
        {problem ? <p className="m-0 text-[12px] text-[var(--ot-warn-text)]">{problem}</p> : null}
      </div>
    )
  }

  if (phase.kind === 'failed') {
    return (
      <div className="flex flex-col gap-2 rounded-[10px] bg-[var(--ot-block-bg)] px-3 py-[11px]">
        <span className="text-[13.5px] font-semibold text-[var(--ot-block-text)]">It did not go through</span>
        <p className="m-0 text-[12.5px] leading-[1.45] text-[var(--ot-text)]">{phase.reason} Nothing else was sent.</p>
        {phase.txHash && explorer(phase.txHash) ? (
          <a href={explorer(phase.txHash)!} target="_blank" rel="noreferrer" className="text-[12px] text-[var(--ot-plan-text)]">
            See the failed transaction
          </a>
        ) : null}
      </div>
    )
  }

  if (!open) return null

  const busy = phase.kind === 'signing' || phase.kind === 'switching'

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5 rounded-[10px] bg-[var(--ot-card)] px-3 py-[11px]">
        <span className="text-[11.5px] text-[var(--ot-text-3)]">One signature in your wallet</span>
        <div className="flex items-center gap-2">
          <span
            aria-hidden
            className="flex h-[19px] w-[19px] flex-none items-center justify-center rounded-full bg-[var(--ot-surface-3)] text-[10.5px] font-semibold text-[var(--ot-text-3)]"
          >
            1
          </span>
          <span className="text-[13px] text-[var(--ot-text-2)]">{plan.humanPlan.steps[0] ?? plan.humanPlan.summary}</span>
        </div>
      </div>

      {problem ? (
        <p role="alert" className="m-0 rounded-[8px] bg-[var(--ot-warn-bg)] px-3 py-2 text-[12.5px] text-[var(--ot-warn-text)]">
          {problem}
        </p>
      ) : null}

      <div className="flex gap-2">
        <Button variant="secondary" size="lg" fullWidth disabled={busy} onClick={() => setConfirmCancel(true)}>
          Cancel
        </Button>
        {gate.kind === 'ready' ? (
          <Button variant="primary" size="lg" fullWidth disabled={busy || !ready} onClick={sign}>
            {phase.kind === 'signing' ? 'Check your wallet…' : 'Sign'}
          </Button>
        ) : gate.kind === 'wrong_chain' ? (
          <Button variant="primary" size="lg" fullWidth disabled={busy} onClick={switchChain}>
            {phase.kind === 'switching' ? 'Switching…' : `Switch to ${chainName(chain)}`}
          </Button>
        ) : (
          <Button variant="primary" size="lg" fullWidth disabled={!ready} onClick={() => connectWallet({ suggestedAddress: wanted })}>
            Connect wallet
          </Button>
        )}
      </div>

      <p className="m-0 text-center text-[12px] text-[var(--ot-text-2)]">
        {gate.kind === 'ready' ? (
          <>
            Signing with <strong className="text-[var(--ot-text)]">{signerName}</strong> on {chainName(chain)}
          </>
        ) : gate.kind === 'wrong_chain' ? (
          <>
            <strong className="text-[var(--ot-text)]">{signerName}</strong> is on {chainName(gate.on)}; this plan runs on{' '}
            {chainName(chain)}
          </>
        ) : gate.kind === 'wrong_account' ? (
          <>
            Connected as {truncateAddress(gate.connected)}. This plan needs{' '}
            <strong className="text-[var(--ot-text)]">{signerName}</strong>.
          </>
        ) : (
          <>
            Connect <strong className="text-[var(--ot-text)]">{signerName}</strong> to sign
          </>
        )}
      </p>

      <Dialog
        open={confirmCancel}
        onClose={() => (cancelling ? undefined : setConfirmCancel(false))}
        title="Cancel this request?"
        tone="destructive"
        description="The agent will be told it was cancelled. Nothing has been signed, and nothing will be."
        actions={
          <>
            <Button variant="secondary" disabled={cancelling} onClick={() => setConfirmCancel(false)}>
              Keep it
            </Button>
            <Button variant="destructive" disabled={cancelling} onClick={cancel}>
              {cancelling ? 'Cancelling…' : 'Cancel request'}
            </Button>
          </>
        }
      />
    </div>
  )
}
