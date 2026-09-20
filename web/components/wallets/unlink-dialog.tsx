'use client'

import { useState } from 'react'
import { Button, Dialog } from '@/components/ui'
import type { Arm } from '@/lib/api'
import { armName } from './naming'

export interface UnlinkDialogProps {
  /** The arm being unlinked, or null for a closed dialog. */
  arm: Arm | null
  onClose: () => void
  onUnlink: (arm: Arm) => Promise<void>
}

/**
 * The one confirm for unlinking, shared by Settings and the portfolio's
 * wallets tab, so the two cannot describe the cost differently.
 *
 * On failure the dialog stays open holding the error. Closing it would look
 * exactly like success, and the wallet would still be linked. Rejecting the
 * signature in the wallet lands here too, which is why the wording does not
 * assert that anything went wrong on our side.
 */
export function UnlinkDialog({ arm, onClose, onUnlink }: UnlinkDialogProps) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function dismiss() {
    if (busy) return
    setError(null)
    onClose()
  }

  async function confirm() {
    if (!arm) return
    setBusy(true)
    setError(null)
    try {
      await onUnlink(arm)
      onClose()
    } catch {
      setError('That wallet is still linked. Nothing changed — try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open={arm !== null}
      onClose={dismiss}
      tone="destructive"
      title={`Unlink ${arm ? armName(arm) : ''}?`}
      description={
        arm?.isWatchOnly
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
  )
}
