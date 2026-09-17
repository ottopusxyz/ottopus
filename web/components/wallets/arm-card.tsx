import { Chip } from '@/components/ui'
import type { Arm } from '@/lib/api'
import { truncateAddress } from '@/lib/format'
import { WALLET_AVATARS, armName, walletClientName } from './naming'
import { ProofMark } from './proof-mark'

function Avatar({ arm, size = 34 }: { arm: Arm; size?: number }) {
  const brand = WALLET_AVATARS[arm.walletType]
  return (
    <span
      aria-hidden
      style={{
        width: size,
        height: size,
        background: brand?.bg ?? 'var(--ot-surface-3)',
        color: brand?.fg ?? 'var(--ot-text-2)',
      }}
      className="font-display flex flex-none items-center justify-center rounded-[10px] text-[15px] font-bold"
    >
      {armName(arm).charAt(0).toUpperCase()}
    </span>
  )
}

export interface ArmCardProps {
  arm: Arm
  /** Right-hand figure. Null until the portfolio connector lands. */
  value?: string | null
  share?: string | null
}

/**
 * An arm on the portfolio, per the P2 wallets view.
 *
 * Read-only by design: unlinking lives on Settings, where the confirm can say
 * what it costs without a balance sheet competing for attention.
 */
export function ArmCard({ arm, value = null, share = null }: ArmCardProps) {
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
