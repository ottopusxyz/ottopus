'use client'

import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { Otto } from '@/components/brand'
import { LoaderDots, TentacleRing } from '@/components/motion'
import { Button, Dialog } from '@/components/ui'
import type { Plan, WebTransition } from '@/lib/api'
import { chainName, explorerName, explorerTxUrl } from '@/lib/chains'
import { cn } from '@/lib/cn'
import { addressOf, truncateAddress } from '@/lib/format'
import {
  describeConnectError,
  installedConnector,
  installedFor,
  isPhone,
  needsSwitch,
  pairingLink,
  preloadSdkWallets,
  routeFor,
  routeForSdk,
  sdkWalletLinked,
  sdkWalletsHere,
  switchTo,
  walletConnectProjectId,
  walletLinks,
  type Connector,
  type DirectoryWallet,
  type Held,
  type InjectedWallet,
  type Route,
  type SdkWallet,
  type WalletFace,
  type WalletProvider,
} from './connectors'
import { approvals, chainOfPlan, type PlanStep, planSteps, standingApproval } from './model'
import {
  BatchAccepted,
  type Batching,
  type Eip1193,
  SequentialNeedsConsent,
  UserRejected,
  describeWalletError,
  probeBatching,
  sendPlanCalls,
  waitForReceipt,
} from './send-calls'
import { useSigner } from './use-signer'
import { SignerChip } from './signer-chip'
import { gateFor, signerStatus } from './wallet-gate'
import { WalletConnecting, type ConnectingStep } from './wallet-connecting'
import { WalletPicker } from './wallet-picker'

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
   * Re-run the calls immediately before the wallet is asked to sign: the plan
   * was built minutes ago and the last thing a person should do is send a
   * transaction the chain has already started refusing.
   *
   * Untraced and read straight from the chain, never through the wallet.
   */
  recheck?: (() => Promise<{ success: boolean; revertReason?: string; failedCall?: number } | null>) | undefined
  /**
   * The wallet app the plan's account was linked with. Display metadata from
   * outside the plan, editable and possibly stale: it chooses which wallet
   * the button opens first and nothing else.
   */
  walletType?: string | undefined
}

/** A connected account, whichever way it was connected. */
interface Connected {
  address: string
  chainId: string
  provider: () => Promise<Eip1193>
}

/** What a retry repeats: an installed wallet, or a pairing with the wallet picked (null for any phone wallet). */
type Again = { installed: InjectedWallet } | { sdk: SdkWallet } | { elsewhere: DirectoryWallet | null }

type Phase =
  | { kind: 'idle' }
  | { kind: 'connecting' }
  | { kind: 'switching' }
  | { kind: 'signing' }
  | { kind: 'submitted'; txHash: `0x${string}` }
  | { kind: 'confirmed'; txHash: `0x${string}` }
  | { kind: 'failed'; txHash: `0x${string}` | null; reason: string }

const isHash = (v: unknown): v is `0x${string}` => typeof v === 'string' && /^0x[0-9a-f]{64}$/i.test(v)

export function SignPanel({ plan, move, open, txHash, recheck, walletType }: SignPanelProps) {
  const router = useRouter()
  const chain = chainOfPlan(plan)
  const { installed, signer, connect: connectWith, walletConnect, refresh, disconnect: disconnectSigner } = useSigner(chain)
  const [picking, setPicking] = useState(false)
  /** The wallet being opened, how far it got, and what "Try again" asks; the connecting dialog draws this. */
  const [attempt, setAttempt] = useState<{ wallet: WalletFace; step: ConnectingStep; again: Again } | null>(null)
  /** Bumped by every new attempt and every dismissal, so a late answer changes nothing on screen. */
  const attemptId = useRef(0)
  // A page opened on a plan already submitted starts where the plan is.
  const [phase, setPhase] = useState<Phase>(() =>
    plan.status === 'submitted' && isHash(txHash) ? { kind: 'submitted', txHash } : { kind: 'idle' },
  )
  const watching = useRef(false)
  const [problem, setProblem] = useState<string | null>(null)
  /**
   * Set when the wallet will not batch and the plan carries an approval.
   *
   * Not an error state. The person is told exactly what would be left
   * standing if they stopped halfway, and chooses. Refusing on their behalf
   * blocked every swap in every wallet without EIP-5792, which is nearly all
   * of them on an ordinary account.
   */
  const [askConsent, setAskConsent] = useState(false)
  /**
   * Carried in a ref rather than as an argument to `sign`, so the callback
   * keeps its identity — and so the consent survives the re-render that
   * dismisses the prompt without racing it.
   */
  const consented = useRef(false)
  const [confirmCancel, setConfirmCancel] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  /**
   * What the wallet says about batching, for the label only.
   *
   * Never consulted when sending: `sendPlanCalls` offers the batch whatever
   * this says. "unknown" is a real answer and stays silent rather than
   * guessing, because a wallet that cannot be asked is not a wallet that
   * cannot batch.
   */
  const [batching, setBatching] = useState<Batching>('unknown')
  /** Which call the wallet is on, and how many are behind it. */
  const [progress, setProgress] = useState<{ signing: number | null; done: number }>({ signing: null, done: 0 })
  const wroteAwaiting = useRef(false)

  const bound = { account: plan.resolution.account.caip10, chain }
  const wanted = addressOf(bound.account)
  // Only the wallet this page connected itself. Whatever the sign-in library
  // holds is for signing in, and never signs a plan here.
  const connected = useMemo<Connected[]>(
    () =>
      (signer?.accounts ?? []).map((address) => ({
        address,
        chainId: signer!.chainId,
        provider: async () => signer!.wallet.provider,
      })),
    [signer],
  )
  const gate = gateFor(bound, connected)
  const wallet = useMemo(
    () => connected.find((c) => c.address.toLowerCase() === wanted.toLowerCase()),
    [connected, wanted],
  )
  const linked = installedFor(walletType, installed)
  // The device is only known in the browser, so the server render offers none.
  const linkedSdk = useSyncExternalStore(
    noSubscription,
    () => sdkWalletLinked(walletType, here()),
    () => null,
  )
  // What the button opens with no list in between: the installed wallet the
  // account was linked with, else the web wallet it was linked with. Still
  // offered over another wallet a reload brought back with the wrong account;
  // not when that wrong account is in the offered wallet itself, where asking
  // again would only hand back the same one.
  const offer = linked
    ? { name: linked.name, connector: installedConnector(linked) }
    : linkedSdk
      ? { name: linkedSdk.name, connector: linkedSdk.connector }
      : null
  const first =
    offer && (gate.kind === 'connect' || (gate.kind === 'wrong_account' && signer?.wallet.connector !== offer.connector))
      ? offer
      : null
  // Memoised: called bare in the body, it defeated the React Compiler's
  // memoisation of every callback below it.
  const standing = useMemo(() => standingApproval(plan), [plan])
  const steps = useMemo(() => planSteps(plan), [plan])
  const batched = batching === 'yes'
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

  /**
   * Ask once the right wallet is connected, and only when there is more than
   * one call — with a single call there is nothing to batch and nothing worth
   * saying about it.
   */
  useEffect(() => {
    if (!wallet || gate.kind !== 'ready' || steps.length < 2) return
    let live = true
    void (async () => {
      try {
        const answer = await probeBatching(await wallet.provider(), wanted, chain)
        if (live) setBatching(answer)
      } catch {
        if (live) setBatching('unknown')
      }
    })()
    return () => {
      live = false
    }
  }, [wallet, gate.kind, wanted, chain, steps.length])

  // Resume the receipt watch for a submitted plan through the named wallet's
  // provider, when that wallet is connected. Without it the page still shows
  // the hash and the explorer; the job (#40) closes the loop server-side.
  useEffect(() => {
    if (phase.kind !== 'submitted' || !wallet || watching.current) return
    watching.current = true
    const hash = phase.txHash
    void (async () => {
      try {
        const provider = await wallet.provider()
        const outcome = await waitForReceipt(provider, hash)
        if (outcome === 'success') {
          await move({ status: 'confirmed', detail: { txHash: hash } })
          setPhase({ kind: 'confirmed', txHash: hash })
        } else {
          await move({ status: 'failed', detail: { reason: 'reverted', txHash: hash } })
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
    setPhase({ kind: 'switching' })
    setProblem(null)
    try {
      // Straight to the wallet's provider: the wallet may know a chain the
      // wallet library does not list. Both hear the wallet's chainChanged.
      await switchTo(await wallet.provider(), chain)
      await refresh()
    } catch (err) {
      setProblem(`Could not switch to ${chainName(chain)}: ${describeWalletError(err)}`)
    } finally {
      setPhase({ kind: 'idle' })
    }
  }, [wallet, chain, refresh])

  /** What follows a wallet's yes, however it was reached: the one switch on the back of the click. */
  const settle = useCallback(
    async (mine: number, face: WalletFace, provider: WalletProvider, held: Held, again: Again) => {
      if (needsSwitch(held, wanted, chain)) {
        // Name and icon only: `face` may be the whole wallet, and its provider must not become a prop.
        setAttempt({ wallet: { name: face.name, icon: face.icon }, step: { kind: 'switching', chain: chainName(chain) }, again })
        setPhase({ kind: 'switching' })
        try {
          await switchTo(provider, chain)
          await refresh()
        } catch (err) {
          if (mine === attemptId.current) setProblem(`Could not switch to ${chainName(chain)}: ${describeWalletError(err)}`)
        }
      }
      if (mine !== attemptId.current) return
      setAttempt(null)
      setPhase({ kind: 'idle' })
    },
    [refresh, wanted, chain],
  )

  /**
   * Open one wallet through its connector, whichever kind it is. If it
   * answers with the plan's account on another chain, the switch is asked for
   * once on the back of the same click; declined, the switch button is the
   * retry. A different account is never asked to switch.
   *
   * The dialog stays up while the wallet is silent. Dismissing it, or leaving
   * for another wallet, stops the page waiting; the wallet's own request
   * cannot be withdrawn, and a late approval of it still connects unless
   * another wallet was asked since.
   *
   * `shown` is what the dialog calls the wallet; `face` is what the connector
   * is told the person picked, null to let the wallet name itself. `href`
   * turns a pairing code into a link that hands it to a wallet app.
   */
  const openWallet = useCallback(
    async (
      connector: Connector,
      opts: { shown: WalletFace; face: WalletFace | null; again: Again; href?: (uri: string) => string | null },
    ) => {
      const mine = ++attemptId.current
      const { shown, again } = opts
      const first: ConnectingStep =
        connector.kind === 'walletconnect'
          ? { kind: 'pairing', uri: null, href: null }
          : { kind: 'opening', popup: connector.kind === 'sdk' }
      setPicking(false)
      setProblem(null)
      setAttempt({ wallet: shown, step: first, again })
      setPhase({ kind: 'connecting' })
      try {
        const found = await connectWith(connector, {
          face: opts.face,
          onUri: (uri) => {
            if (mine !== attemptId.current) return
            setAttempt({ wallet: shown, step: { kind: 'pairing', uri, href: opts.href?.(uri) ?? null }, again })
          },
        })
        if (!found || mine !== attemptId.current) return
        await settle(mine, found.wallet, found.wallet.provider, found.held, again)
      } catch (err) {
        if (mine !== attemptId.current) return
        setAttempt({ wallet: shown, step: { kind: 'failed', reason: describeConnectError(err, shown.name) }, again })
        setPhase({ kind: 'idle' })
      }
    },
    [connectWith, settle],
  )

  /** An installed wallet, with no list in between. */
  const connect = useCallback(
    (target: InjectedWallet) => openWallet(installedConnector(target), { shown: target, face: null, again: { installed: target } }),
    [openWallet],
  )

  /** Take a route: leave for the wallet's app, open its own SDK, or draw a pairing code in our own dialog. */
  const follow = useCallback(
    (route: Route, face: WalletFace, again: Again, choice: DirectoryWallet | null) => {
      if (route.via === 'app-link') {
        setPicking(false)
        window.location.assign(route.href)
        return
      }
      if (route.via === 'sdk') return openWallet(route.wallet.connector, { shown: face, face, again })
      if (!walletConnect) return
      const onPhone = isPhone(window.navigator.userAgent)
      return openWallet(walletConnect, {
        shown: face,
        face: choice ? face : null,
        again,
        // On a phone the code cannot be scanned off its own screen: hand it to
        // the app picked, or as a bare wc: link to whichever wallet answers it.
        href: (uri) => (!onPhone ? null : choice ? pairingLink(choice, uri) : uri),
      })
    },
    [walletConnect, openWallet],
  )

  /**
   * A wallet that is not in this browser. `choice` is the wallet picked from
   * the registry; null is "whatever is on my phone", which any wallet app can
   * scan.
   */
  const connectElsewhere = useCallback(
    (choice: DirectoryWallet | null) => {
      const face: WalletFace = choice ? { name: choice.name, icon: choice.icon } : { name: 'your wallet', icon: null }
      return follow(routeFor(choice, here()), face, { elsewhere: choice }, choice)
    },
    [follow],
  )

  /** A wallet with a connector of its own, picked from its own row. Needs nothing from the registry. */
  const connectSdk = useCallback(
    (target: SdkWallet) => follow(routeForSdk(target, here()), { name: target.name, icon: target.icon }, { sdk: target }, null),
    [follow],
  )

  // An SDK wallet's window can only open on the back of a click, so its code
  // is fetched while the list is still being read.
  useEffect(() => {
    if (picking) preloadSdkWallets()
  }, [picking])
  useEffect(() => {
    if (!linked) linkedSdk?.preload()
  }, [linked, linkedSdk])

  /** Stop waiting on the wallet being opened. Its answer, if it comes, no longer moves the page. */
  const stopWaiting = useCallback(() => {
    attemptId.current++
    setAttempt(null)
    setPhase((p) => (p.kind === 'connecting' || p.kind === 'switching' ? { kind: 'idle' } : p))
  }, [])

  /** Back to the connect button, for a person who brought the wrong wallet. */
  const disconnect = useCallback(() => {
    attemptId.current++
    setAttempt(null)
    setProblem(null)
    setAskConsent(false)
    setBatching('unknown')
    disconnectSigner()
  }, [disconnectSigner])

  const sign = useCallback(async () => {
    if (!wallet || gate.kind !== 'ready' || plan.outcome.type !== 'calls') return
    setProblem(null)
    setAskConsent(false)
    setProgress({ signing: null, done: 0 })
    setPhase({ kind: 'signing' })
    let txHash: `0x${string}` | null = null
    try {
      const provider = await wallet.provider()
      // The last check before the wallet opens. A run that cannot answer says
      // nothing and does not stop anybody; one that reverts does, because the
      // alternative is a signature that burns a fee for nothing.
      if (recheck) {
        const fresh = await recheck()
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
        // Nothing could be left standing, or the person has been shown what
        // would be and said yes.
        sequentialIsSafe: plan.outcome.calls.length === 1 || approvals(plan).length === 0 || consented.current,
        onStep: (index, phase) =>
          setProgress((held) =>
            phase === 'signing' ? { ...held, signing: index } : { signing: null, done: index + 1 },
          ),
      })
      txHash = sent.txHash
      await move({ status: 'submitted', detail: { txHash } })
      // The watch effect takes it from here, for this page and for any reopened one.
      setPhase({ kind: 'submitted', txHash })
    } catch (err) {
      if (err instanceof SequentialNeedsConsent) {
        setPhase({ kind: 'idle' })
        setAskConsent(true)
        return
      }
      if (err instanceof UserRejected) {
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
      setProblem(describeWalletError(err))
    }
  }, [wallet, gate.kind, plan, wanted, chain, move, recheck])

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
        <Settled />
        <span className="font-[family-name:var(--ot-font-display)] text-[19px] font-bold">Signed and settled</span>
        <p className="m-0 text-[12.5px] leading-[1.45] text-[var(--ot-text-2)]">
          {plan.humanPlan.summary}. Confirmed on {chainName(chain)}.
        </p>
        <div className="flex w-full gap-2">
          {explorer(phase.txHash) ? (
            <Button variant="secondary" size="sm" fullWidth onClick={() => window.open(explorer(phase.txHash)!, '_blank', 'noreferrer')}>
              View on {explorerName(chain)}
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
        {/* Otto taps the cube: he is watching the chain, and the wait is his, not a bar's. */}
        <div className="flex items-center gap-3">
          <Otto pose="tapping" size={56} animated label="Otto, watching the chain" className="-my-2 flex-none" />
          <div className="flex flex-col gap-0.5">
            <LoaderDots label="Pending confirmation" className="font-semibold text-[var(--ot-text)]" />
            <p className="m-0 text-[12.5px] leading-[1.45] text-[var(--ot-text-2)]">
              Your wallet sent it. Close this page if you like — the transaction finishes either way.
            </p>
          </div>
        </div>
        {explorer(phase.txHash) ? (
          <a href={explorer(phase.txHash)!} target="_blank" rel="noreferrer" className="text-[12px] text-[var(--ot-plan-text)]">
            Follow it on {explorerName(chain)}
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

  const busy = phase.kind === 'signing' || phase.kind === 'switching' || phase.kind === 'connecting'

  return (
    <div className="flex flex-col gap-3">
      {/*
        The wait is the screen here, which is what earns it Otto rather than
        geometry alone. The step list below narrates the handshake; the ring
        in the button is the design's inline wait.
      */}
      {phase.kind === 'signing' ? (
        <div className="flex items-center gap-3 rounded-[10px] bg-[var(--ot-card)] px-3 py-2">
          <Otto pose="plan-ready" size={56} animated label="Otto, holding the plan" className="-my-2 flex-none" />
          <div className="flex flex-col gap-0.5">
            <LoaderDots label="Waiting on your wallet" className="font-semibold text-[var(--ot-text)]" />
            <p className="m-0 text-[12px] leading-[1.45] text-[var(--ot-text-2)]">Nothing is sent until you approve there.</p>
          </div>
        </div>
      ) : null}
      <PlanStepList
        steps={steps}
        batched={batched}
        known={batching !== 'unknown'}
        signing={phase.kind === 'signing'}
        progress={progress}
      />

      {problem ? (
        <p role="alert" className="m-0 rounded-[8px] bg-[var(--ot-warn-bg)] px-3 py-2 text-[12.5px] text-[var(--ot-warn-text)]">
          {problem}
        </p>
      ) : null}

      {/*
        What signing will actually involve, once the wallet is connected and
        there is more than one step. Silent on "unknown": a wallet that could
        not be asked is not a wallet that cannot batch, and the send path
        tries regardless.
      */}
      {/*
        The wallet will not batch. Say exactly what stopping halfway would
        leave behind, then let the person decide — an allowance for a named
        amount to the router this plan already shows is a risk somebody can
        weigh, and refusing on their behalf just ended the flow.
      */}
      {askConsent ? (
        <div role="alert" className="flex flex-col gap-2 rounded-[10px] bg-[var(--ot-warn-bg)] px-3 py-2.5">
          <p className="m-0 text-[12.5px] leading-[1.5] text-[var(--ot-warn-text)]">
            {plan.outcome.type === 'calls' && plan.outcome.calls.length > 2
              ? `This wallet cannot send these ${plan.outcome.calls.length} steps together, so you would sign them one at a time, the allowance before the swap.`
              : 'This wallet cannot send both steps together, so you would approve first and swap second.'}
            {standing
              ? standing.unlimited
                ? ` If you stop after the first, an unlimited allowance to ${truncateAddress(addressOf(standing.spender))} would remain.`
                : ` If you stop after the first, an allowance for ${standing.amount} ${standing.symbol} to ${truncateAddress(addressOf(standing.spender))} would remain — nothing more, and only to that address.`
              : ''}
          </p>
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" onClick={() => setAskConsent(false)}>
              Not now
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={() => {
                consented.current = true
                void sign()
              }}
            >
              Sign one at a time
            </Button>
          </div>
        </div>
      ) : null}

      <div className="flex gap-2">
        <Button variant="secondary" size="lg" fullWidth disabled={busy} onClick={() => setConfirmCancel(true)}>
          Cancel
        </Button>
        {gate.kind === 'ready' ? (
          <Button variant="primary" size="lg" fullWidth disabled={busy} onClick={() => void sign()}>
            {phase.kind === 'signing' ? (
              <span className="inline-flex items-center gap-2">
                <TentacleRing size={18} tone="current" />
                Check your wallet
              </span>
            ) : (
              'Sign'
            )}
          </Button>
        ) : gate.kind === 'wrong_chain' ? (
          <Button variant="primary" size="lg" fullWidth disabled={busy} onClick={switchChain}>
            {phase.kind === 'switching' ? (
              <span className="inline-flex items-center gap-2">
                <TentacleRing size={18} tone="current" />
                Switching
              </span>
            ) : (
              `Switch to ${chainName(chain)}`
            )}
          </Button>
        ) : (
          <Button
            variant="primary"
            size="lg"
            fullWidth
            disabled={busy}
            onClick={() => {
              if (!first) setPicking(true)
              else if (linked) void connect(linked)
              else if (linkedSdk) void connectSdk(linkedSdk)
            }}
          >
            {phase.kind === 'connecting' ? (
              <span className="inline-flex items-center gap-2">
                <TentacleRing size={18} tone="current" />
                Check your wallet
              </span>
            ) : first ? (
              `Connect ${first.name}`
            ) : (
              'Connect wallet'
            )}
          </Button>
        )}
      </div>

      <SignerChip
        status={signerStatus(gate, {
          signerName,
          wantedShort: truncateAddress(wanted),
          connectedShort: gate.kind === 'wrong_account' ? truncateAddress(gate.connected) : null,
          chainName: chainName(chain),
          onChainName: gate.kind === 'wrong_chain' ? chainName(gate.on) : null,
          wallet: signer ? { name: signer.wallet.name, kind: signer.wallet.connector.kind } : null,
        })}
        // The face alone, never the wallet: in development React reads every
        // prop a few levels deep, and a web wallet's provider holds its
        // cross-origin window, which throws when read.
        wallet={signer ? { name: signer.wallet.name, icon: signer.wallet.icon } : null}
        onDisconnect={disconnect}
        disabled={busy}
      />

      {first ? (
        <Button variant="link" size="sm" className="self-center" disabled={busy} onClick={() => setPicking(true)}>
          Use another wallet
        </Button>
      ) : null}

      <WalletPicker
        open={picking}
        onClose={() => setPicking(false)}
        account={wanted}
        accountLabel={plan.resolution.account.label}
        chainName={chainName(chain)}
        installed={installed}
        linked={linked}
        onPick={(target) => void connect(target)}
        links={phoneLinks(walletType)}
        linkedType={walletType}
        sdkWallets={typeof window === 'undefined' ? [] : sdkWalletsHere(here())}
        linkedSdk={linkedSdk}
        onPickSdk={(target) => void connectSdk(target)}
        projectId={walletConnect ? walletConnectProjectId() : null}
        onPair={(choice) => void connectElsewhere(choice)}
      />

      <WalletConnecting
        wallet={attempt?.wallet ?? null}
        step={attempt?.step ?? { kind: 'opening' }}
        onClose={stopWaiting}
        onRetry={() => {
          if (!attempt) return
          if ('installed' in attempt.again) void connect(attempt.again.installed)
          else if ('sdk' in attempt.again) void connectSdk(attempt.again.sdk)
          else void connectElsewhere(attempt.again.elsewhere)
        }}
        onMore={() => {
          stopWaiting()
          setPicking(true)
        }}
      />

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


/**
 * Every call the wallet will be asked for, in order.
 *
 * The one thing this has to get right is honesty about how many signatures
 * are coming. A batched plan is one signature over the whole list, so the
 * rows are bracketed together and share a state; a sequential one is a
 * signature each, so the rows are numbered and only the current one is lit.
 *
 * "unknown" gets the plain numbered list with no claim either way, because a
 * wallet that could not be asked is not a wallet that cannot batch.
 */
function PlanStepList({
  steps,
  batched,
  known,
  signing,
  progress,
}: {
  steps: readonly PlanStep[]
  batched: boolean
  known: boolean
  signing: boolean
  progress: { signing: number | null; done: number }
}) {
  if (steps.length === 0) return null
  const many = steps.length > 1
  const heading = !many
    ? 'One signature in your wallet'
    : batched
      ? `${steps.length} steps, one signature`
      : known
        ? `${steps.length} steps, a signature each`
        : `${steps.length} steps in your wallet`

  return (
    <div className="flex flex-col gap-2 rounded-[10px] bg-[var(--ot-card)] px-3 py-[11px]">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[11.5px] text-[var(--ot-text-3)]">{heading}</span>
        {many && batched ? (
          <span className="flex items-center gap-1 text-[10.5px] font-semibold text-[var(--ot-ok-text)]">
            <BatchMark />
            batched
          </span>
        ) : null}
      </div>

      <div className={cn('flex gap-2.5', many && batched && 'ot-batch-group')}>
        {/* One brace for a batch: the rows are one action to the wallet. */}
        {many && batched ? <span aria-hidden className="ot-batch-brace mt-0.5 mb-0.5 w-[3px] flex-none rounded-full" /> : null}
        <ol className="m-0 flex flex-1 list-none flex-col gap-1.5 p-0">
          {steps.map((step, i) => {
            const done = batched ? false : i < progress.done
            const active = batched ? signing : signing && progress.signing === i
            return (
              <li key={step.index} className="flex items-center gap-2">
                <span
                  aria-hidden
                  className={cn(
                    'flex h-[19px] w-[19px] flex-none items-center justify-center rounded-full text-[10.5px] font-semibold transition-colors',
                    done
                      ? 'bg-[var(--ot-ok-bg)] text-[var(--ot-ok-text)]'
                      : active
                        ? 'bg-[var(--ot-plan)] text-[var(--ot-on-state)]'
                        : 'bg-[var(--ot-surface-3)] text-[var(--ot-text-3)]',
                  )}
                >
                  {done ? '✓' : batched ? '•' : step.index}
                </span>
                <span className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-1.5">
                  <span className={cn('text-[13px]', active ? 'font-semibold text-[var(--ot-text)]' : 'text-[var(--ot-text-2)]')}>
                    {step.label}
                  </span>
                  {step.detail ? <span className="text-[11px] text-[var(--ot-text-3)]">{step.detail}</span> : null}
                </span>
                {active && !batched ? (
                  <span className="flex-none text-[10.5px] font-medium text-[var(--ot-plan-text)]">in your wallet</span>
                ) : null}
              </li>
            )
          })}
        </ol>
      </div>
    </div>
  )
}

/**
 * Otto after settlement: one ripple, then he keeps hopping. The ripple plays
 * once because it marks a moment; the hop goes on because the moment is his.
 */
export function Settled() {
  return (
    <div className="relative flex h-[96px] w-[96px] items-end justify-center">
      <span aria-hidden className="ot-settle-ripple absolute top-4 h-16 w-16 rounded-full bg-[var(--ot-navy-soft)]" />
      <div className="ot-celebrate relative">
        <Otto pose="confirmed" size={88} animated label="Otto, arms up" />
      </div>
    </div>
  )
}

/** Two shapes closing into one. Static: this page holds still. */
function BatchMark() {
  return (
    <svg aria-hidden viewBox="0 0 12 12" className="h-3 w-3 flex-none" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round">
      <rect x="1.2" y="1.3" width="9.6" height="9.4" rx="2.6" />
      <path d="M3.9 6h4.2M6 3.9v4.2" strokeLinecap="round" strokeWidth="1.2" opacity="0.6" />
    </svg>
  )
}

/** The device and page a wallet is being routed from. Only ever called in the browser. */
const noSubscription = () => () => {}

function here() {
  return { onPhone: isPhone(window.navigator.userAgent), pageUrl: window.location.href }
}

/** Wallet apps that can open this page themselves; none off a phone. */
function phoneLinks(walletType: string | undefined) {
  if (typeof window === 'undefined' || !isPhone(window.navigator.userAgent)) return []
  return walletLinks(window.location.href, walletType)
}
