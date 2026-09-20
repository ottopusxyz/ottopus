'use client'

import { useState } from 'react'
import { AddressChip, Button } from '@/components/ui'
import type { Arm } from '@/lib/api'
import { armName, walletClientName } from './naming'
import { ProofMark } from './proof-mark'
import { UnlinkDialog } from './unlink-dialog'

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
                <AddressChip address={arm.address} className="w-fit px-2 py-0.5 text-[12px] text-[var(--ot-text-3)]" />
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

      <UnlinkDialog arm={confirming} onClose={() => setConfirming(null)} onUnlink={onUnlink} />
    </>
  )
}
