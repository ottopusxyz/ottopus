'use client'

import { useState } from 'react'
import { AddressChip, Button, Chip } from '@/components/ui'
import type { Arm } from '@/lib/api'
import { cn } from '@/lib/cn'
import { WALLET_AVATARS, armName, walletClientName, walletMark } from './naming'
import { ProofMark } from './proof-mark'

/**
 * The wallet client's own mark where we bundle one, and the lettered brand tile
 * where we do not. The mark follows from the type stored on the arm, so it is
 * the same on every device and surface — it used to come from whatever the
 * connected extension announced, which made it depend on the browser you were
 * in and left nothing for an arm linked elsewhere.
 *
 * The tile is not a placeholder for a missing icon: its colour is the client's
 * own brand, picked in naming.ts to clear AA against the glyph, and it is how
 * the eight arms are told apart before any of them is read. So the icon sits on
 * a neutral card rather than on that tint, which would put an orange fox on an
 * orange ground.
 */
function Avatar({ arm, size = 34 }: { arm: Arm; size?: number }) {
  const icon = walletMark(arm.walletType)
  const brand = WALLET_AVATARS[arm.walletType]
  const [failed, setFailed] = useState(false)
  const showIcon = !!icon && !failed
  return (
    <span
      aria-hidden
      style={{
        width: size,
        height: size,
        background: showIcon ? 'var(--ot-card)' : (brand?.bg ?? 'var(--ot-surface-3)'),
        color: brand?.fg ?? 'var(--ot-text-2)',
      }}
      className={cn(
        'font-display flex flex-none items-center justify-center overflow-hidden rounded-[10px] text-[15px] font-bold',
        showIcon && 'ring-1 ring-[var(--ot-border)]',
      )}
    >
      {showIcon ? (
        // A bundled file, so a failure here is a mark removed without naming.ts
        // being told; the tile is the fallback either way.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={icon}
          alt=""
          width={size}
          height={size}
          // Full bleed with the tile's own radius: the bundled marks are app
          // icons with their own backgrounds, and a square one sitting inset
          // in a rounded tile read as a sticker rather than the wallet.
          className="h-full w-full rounded-[10px] object-cover"
          onError={() => setFailed(true)}
        />
      ) : armName(arm).charAt(0).toUpperCase()}
    </span>
  )
}

export interface ArmCardProps {
  arm: Arm
  /** Formatted balance. Null while the balance is unknown. */
  value?: string | null
  share?: string | null
  /** Asks to unlink this arm. The confirm is the caller's (UnlinkDialog); absent, the card is read-only. */
  onUnlink?: (() => void) | undefined
}

/**
 * An arm on the portfolio, per the P2 wallets view. The address is a chip that
 * copies itself, and Unlink is the same confirm Settings uses.
 */
export function ArmCard({ arm, value = null, share = null, onUnlink }: ArmCardProps) {
  const client = walletClientName(arm)

  return (
    <div className="flex items-center justify-between gap-4 rounded-[12px] border border-[var(--ot-border)] bg-[var(--ot-card)] px-4 py-3.5">
      <div className="flex min-w-0 items-center gap-3">
        <Avatar arm={arm} />
        <div className="flex min-w-0 flex-col gap-[3px]">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate text-[15px] font-semibold">{armName(arm)}</span>
            <ProofMark isWatchOnly={arm.isWatchOnly} />
            {client ? <Chip className="text-[11px]">{client}</Chip> : null}
            {arm.isWatchOnly ? <Chip className="text-[11px]">Watch only</Chip> : null}
          </div>
          <AddressChip address={arm.address} className="w-fit px-2 py-0.5 text-[12px] text-[var(--ot-text-3)]" />
        </div>
      </div>
      <div className="flex flex-none items-center gap-3">
        <div className="flex flex-col gap-0.5 text-right">
          <code className="font-mono text-[17px] font-semibold tabular-nums">{value ?? '—'}</code>
          <span className="text-[12px] text-[var(--ot-text-3)]">{share ?? 'Balance pending'}</span>
        </div>
        {onUnlink ? (
          <Button variant="ghost" size="sm" onClick={onUnlink} aria-label={`Unlink ${armName(arm)}`}>
            Unlink
          </Button>
        ) : null}
      </div>
    </div>
  )
}
