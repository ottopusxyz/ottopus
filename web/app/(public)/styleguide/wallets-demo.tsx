'use client'

import { ArmCard, WalletList } from '@/components/wallets'
import type { Arm } from '@/lib/api'

/**
 * The arm surfaces with fictional data, so they can be seen without signing in.
 *
 * A client component because WalletList takes an unlink handler, and a server
 * component cannot hand a function across the boundary.
 */
export function WalletsDemo({ arms }: { arms: Arm[] }) {
  return (
    <>
      <div className="flex flex-col gap-2.5">
        {arms.map((arm) => (
          <ArmCard key={arm.id} arm={arm} />
        ))}
      </div>
      <div className="overflow-hidden rounded-[18px] border border-[var(--ot-border)] bg-[var(--ot-card)]">
        {/* Unlinking a fictional arm does nothing; the confirm still opens, which
            is the part worth looking at here. */}
        <WalletList wallets={arms} onUnlink={async () => {}} />
      </div>
    </>
  )
}
