'use client'

import { useEffect, useState } from 'react'
import { OttoBadge } from '@/components/brand'
import { Button, Dialog } from '@/components/ui'
import type { InjectedWallet } from './injected'
import { WalletMark } from './wallet-picker'

/** After this long with no answer, say where the wallet's window usually hides. */
const SLOW_AFTER_MS = 8000

export type ConnectingStep =
  | { kind: 'opening' }
  | { kind: 'switching'; chain: string }
  | { kind: 'failed'; reason: string }

export interface WalletConnectingProps {
  /** The wallet being opened; null keeps the dialog closed. */
  wallet: InjectedWallet | null
  step: ConnectingStep
  onClose: () => void
  onRetry: () => void
  /** Leaves this wallet for the list of installed ones. */
  onMore: () => void
}

/**
 * What the page shows while a wallet it opened directly has not answered yet:
 * Otto on one side, the wallet's own mark on the other, and a way out.
 *
 * The wallet's request cannot be withdrawn from here, so nothing in this
 * dialog pretends to cancel it. "More wallets" only stops waiting on it.
 */
export function WalletConnecting({ wallet, step, onClose, onRetry, onMore }: WalletConnectingProps) {
  const waiting = wallet !== null && step.kind !== 'failed'
  const [slow, setSlow] = useState(false)
  useEffect(() => {
    if (!waiting) return
    const timer = setTimeout(() => setSlow(true), SLOW_AFTER_MS)
    return () => {
      clearTimeout(timer)
      setSlow(false)
    }
  }, [waiting, step.kind])

  const name = wallet?.name ?? 'wallet'
  const title =
    step.kind === 'failed'
      ? `${name} did not connect`
      : step.kind === 'switching'
        ? `Switching to ${step.chain}`
        : `Opening ${name}`
  const description =
    step.kind === 'failed'
      ? step.reason
      : step.kind === 'switching'
        ? `Approve the network switch in ${name}.`
        : `Approve the connection in ${name}. Nothing is signed yet.`

  return (
    <Dialog
      open={wallet !== null}
      onClose={onClose}
      title={title}
      description={description}
      actions={
        <>
          {step.kind === 'failed' ? (
            <Button variant="primary" onClick={onRetry}>
              Try again
            </Button>
          ) : null}
          <Button variant="secondary" onClick={onMore}>
            More wallets
          </Button>
        </>
      }
    >
      <div className="flex flex-col items-center gap-3 py-2">
        <div className="flex items-center gap-4" role={waiting ? 'status' : undefined} aria-label={waiting ? title : undefined}>
          <OttoBadge size={52} animate={waiting ? 'loader' : 'none'} />
          <span aria-hidden className="inline-flex gap-[5px]">
            {[0, 1, 2].map((i) => (
              <span
                key={i}
                className={
                  waiting
                    ? 'ot-dot h-[6px] w-[6px] rounded-full bg-[var(--ot-plan)]'
                    : 'h-[6px] w-[6px] rounded-full bg-[var(--ot-border-strong)]'
                }
                style={waiting ? { animationDelay: `${i * 0.2}s` } : undefined}
              />
            ))}
          </span>
          {wallet ? <WalletMark icon={wallet.icon} name={wallet.name} size={52} /> : null}
        </div>
        {waiting && slow ? (
          <p className="m-0 text-center text-[12.5px] leading-[1.5] text-[var(--ot-text-2)]">
            Not seeing it? Open {name} from your browser&apos;s toolbar: its request may be waiting behind this
            window.
          </p>
        ) : null}
      </div>
    </Dialog>
  )
}
