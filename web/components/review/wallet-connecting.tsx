'use client'

import { useEffect, useMemo, useState } from 'react'
import { encode } from 'uqr'
import { OttoBadge } from '@/components/brand'
import { Button, Dialog, buttonClasses } from '@/components/ui'
import type { WalletFace } from './connectors'
import { WalletMark } from './wallet-picker'

/** After this long with no answer, say where the wallet's window usually hides. */
const SLOW_AFTER_MS = 8000

export type ConnectingStep =
  /** `popup` is a wallet that answers in a browser window of its own, not an extension. */
  | { kind: 'opening'; popup?: boolean }
  /**
   * A wallet that is not in this browser: the code to scan, once the relay
   * has one, and on a phone the link that opens the wallet app with it.
   */
  | { kind: 'pairing'; uri: string | null; href: string | null }
  | { kind: 'switching'; chain: string }
  | { kind: 'failed'; reason: string }

export interface WalletConnectingProps {
  /** The wallet being opened; null keeps the dialog closed. */
  wallet: WalletFace | null
  step: ConnectingStep
  onClose: () => void
  onRetry: () => void
  /** Leaves this wallet for the list of wallets. */
  onMore: () => void
}

/**
 * What the page shows while a wallet it opened has not answered yet: Otto on
 * one side, the wallet's own mark on the other, and a way out. For a wallet
 * on another device the same dialog carries the pairing code.
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
        : step.kind === 'pairing'
          ? `Connect ${name}`
          : `Opening ${name}`
  const description =
    step.kind === 'failed'
      ? step.reason
      : step.kind === 'switching'
        ? `Approve the network switch in ${name}.`
        : step.kind === 'pairing'
          ? step.href
            ? `Open ${name} and approve the connection. Nothing is signed yet.`
            : `Scan this code with ${name} and approve the connection. Nothing is signed yet.`
          : step.popup
            ? `Sign in to ${name} in the window that opened and approve the connection. Nothing is signed yet.`
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
          {step.kind === 'pairing' && step.href ? (
            <a href={step.href} className={buttonClasses({ variant: 'primary' })}>
              Open {name}
            </a>
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
        {step.kind === 'pairing' ? <Pairing uri={step.uri} /> : null}
        {step.kind === 'opening' && slow ? (
          <p className="m-0 text-center text-[12.5px] leading-[1.5] text-[var(--ot-text-2)]">
            {step.popup ? (
              <>
                Not seeing it? The {name} window may be behind this one, or the browser blocked it: allow popups
                for this site and try again.
              </>
            ) : (
              <>
                Not seeing it? Open {name} from your browser&apos;s toolbar: its request may be waiting behind this
            window.
              </>
            )}
          </p>
        ) : null}
      </div>
    </Dialog>
  )
}

/** A pairing code, as a picture and as text for a wallet that cannot scan this screen. */
function Pairing({ uri }: { uri: string | null }) {
  const [copied, setCopied] = useState(false)
  if (!uri) {
    return <p className="m-0 text-[12.5px] text-[var(--ot-text-2)]">Getting a code…</p>
  }
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(uri)
      setCopied(true)
      setTimeout(() => setCopied(false), 1400)
    } catch {
      // Clipboard can be blocked by permissions; the code is still on screen.
    }
  }
  return (
    <>
      <QrCode value={uri} label="Pairing code" />
      <Button variant="link" size="sm" onClick={() => void copy()}>
        {copied ? 'Copied' : 'Copy the code instead'}
      </Button>
    </>
  )
}

/**
 * Dark modules on white whatever the theme: a scanner needs the contrast, and
 * an inverted code is one some wallets refuse.
 */
function QrCode({ value, label, size = 220 }: { value: string; label: string; size?: number }) {
  const { path, cells } = useMemo(() => {
    const qr = encode(value, { ecc: 'M', border: 2 })
    let d = ''
    qr.data.forEach((row, y) =>
      row.forEach((on, x) => {
        if (on) d += `M${x} ${y}h1v1h-1z`
      }),
    )
    return { path: d, cells: qr.size }
  }, [value])
  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`0 0 ${cells} ${cells}`}
      width={size}
      height={size}
      shapeRendering="crispEdges"
      className="rounded-[10px] bg-white"
    >
      <path d={path} fill="#16213E" />
    </svg>
  )
}
