'use client'

import { useState } from 'react'
import { Button, Dialog } from '@/components/ui'
import type { Arm } from '@/lib/api'
import { truncateAddress } from '@/lib/format'
import { armName, walletClientName } from './naming'
import { ProofMark } from './proof-mark'

export interface WalletListProps {
  wallets: Arm[]
  onUnlink: (arm: Arm) => Promise<void>
}

/**
 * The Settings rows, per P6: name, what kind of wallet, the address, and the
 * one destructive action. Denser than the portfolio card because nothing here
 * competes with a balance.
 */
export function WalletList({ wallets, onUnlink }: WalletListProps) {
  const [confirming, setConfirming] = useState<Arm | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function dismiss() {
    if (busy) return
    setConfirming(null)
    setError(null)
  }

  async function confirm() {
    if (!confirming) return
    setBusy(true)
    setError(null)
    try {
      await onUnlink(confirming)
      setConfirming(null)
    } catch {
      // The dialog stays open holding the error. Closing it on failure would
      // look exactly like success, and the wallet would still be linked.
      //
      // Rejecting the signature in the wallet lands here too, which is why the
      // wording does not assert that anything went wrong on our side.
      setError('That wallet is still linked. Nothing changed — try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <ul className="flex flex-col">
        {wallets.map((arm) => {
          const client = walletClientName(arm)
          return (
            <li
              key={arm.id}
              className="flex items-center justify-between gap-3.5 border-t border-[var(--ot-border)] px-[22px] py-3.5 first:border-t-0"
            >
              <div className="flex min-w-0 flex-col gap-[3px]">
                <span className="flex items-center gap-2 text-[14px] font-semibold">
                  <span className="truncate">{armName(arm)}</span>
                  <ProofMark isWatchOnly={arm.isWatchOnly} />
                  <span className="font-normal text-[var(--ot-text-3)]">
                    {[client, arm.isWatchOnly ? 'watch only' : null].filter(Boolean).join(', ') ||
                      null}
                  </span>
                </span>
                <code className="font-mono text-[12px] text-[var(--ot-text-3)]">
                  {truncateAddress(arm.address)}
                </code>
              </div>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setConfirming(arm)}
                aria-label={`Unlink ${armName(arm)}`}
              >
                Unlink
              </Button>
            </li>
          )
        })}
      </ul>

      <Dialog
        open={confirming !== null}
        onClose={dismiss}
        tone="destructive"
        title={`Unlink ${confirming ? armName(confirming) : ''}?`}
        description={
          confirming?.isWatchOnly
            ? 'Ottopus stops reading its balances and stops counting it when planning.'
            : 'Ottopus stops planning with this wallet. Anything already signed is unaffected, and you can link it again whenever you like.'
        }
        actions={
          <>
            <Button variant="ghost" onClick={dismiss} disabled={busy} fullWidth>
              Keep it
            </Button>
            <Button variant="destructive" onClick={() => void confirm()} disabled={busy} fullWidth>
              {busy ? 'Unlinking…' : 'Unlink'}
            </Button>
          </>
        }
      >
        {error ? (
          <p role="alert" className="text-[13px] leading-[1.5] text-[var(--ot-block-text)]">
            {error}
          </p>
        ) : null}
      </Dialog>
    </>
  )
}
