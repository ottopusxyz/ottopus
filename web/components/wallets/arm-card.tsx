'use client'

import { useState } from 'react'
import { Chip } from '@/components/ui'
import type { Arm } from '@/lib/api'
import { cn } from '@/lib/cn'
import { truncateAddress } from '@/lib/format'
import { WALLET_AVATARS, armName, walletClientName } from './naming'
import { ProofMark } from './proof-mark'

/**
 * The wallet's own logo where we have it, and the lettered brand tile where we
 * do not — an arm linked in another browser has no connector to ask.
 *
 * The tile is not a placeholder for a missing icon: its colour is the client's
 * own brand, picked in naming.ts to clear AA against the glyph, and it is how
 * the eight arms are told apart before any of them is read. So the icon sits on
 * a neutral card rather than on that tint, which would put an orange fox on an
 * orange ground.
 */
function Avatar({ arm, icon, size = 34 }: { arm: Arm; icon?: string | null; size?: number }) {
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
        // Whatever the extension announced about itself — usually a data URI,
        // but the wallet chooses, so this has to be able to fail back.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={icon}
          alt=""
          width={size}
          height={size}
          className="h-full w-full object-contain p-[3px]"
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
  /** The wallet client's own logo, when this arm is connected here. */
  icon?: string | null
}

/**
 * An arm on the portfolio, per the P2 wallets view.
 *
 * Read-only by design: unlinking lives on Settings, where the confirm can say
 * what it costs without a balance sheet competing for attention.
 */
export function ArmCard({ arm, value = null, share = null, icon = null }: ArmCardProps) {
  const client = walletClientName(arm)

  return (
    <div className="flex items-center justify-between gap-4 rounded-[12px] border border-[var(--ot-border)] bg-[var(--ot-card)] px-4 py-3.5">
      <div className="flex min-w-0 items-center gap-3">
        <Avatar arm={arm} icon={icon} />
        <div className="flex min-w-0 flex-col gap-[3px]">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate text-[15px] font-semibold">{armName(arm)}</span>
            <ProofMark isWatchOnly={arm.isWatchOnly} />
            {client ? <Chip className="text-[11px]">{client}</Chip> : null}
            {arm.isWatchOnly ? <Chip className="text-[11px]">Watch only</Chip> : null}
          </div>
          <code className="font-mono text-[12px] text-[var(--ot-text-3)]">
            {truncateAddress(arm.address)}
          </code>
        </div>
      </div>
      <div className="flex flex-none flex-col gap-0.5 text-right">
        <code className="font-mono text-[17px] font-semibold tabular-nums">{value ?? '—'}</code>
        <span className="text-[12px] text-[var(--ot-text-3)]">{share ?? 'Balance pending'}</span>
      </div>
    </div>
  )
}
