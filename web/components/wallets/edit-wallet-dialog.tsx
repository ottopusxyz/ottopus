'use client'

import { useState } from 'react'
import { Button, Dialog, Input } from '@/components/ui'
import type { Arm } from '@/lib/api'
import { cn } from '@/lib/cn'
import { EDITABLE_TYPES, WALLET_NAMES, armName, walletMark } from './naming'

export interface WalletEdit {
  label: string | null
  walletType: string
}

export interface EditWalletDialogProps {
  /** The arm being edited, or null for a closed dialog. */
  arm: Arm | null
  onClose: () => void
  onSave: (arm: Arm, edit: WalletEdit) => Promise<void>
}

/**
 * The name, and which wallet it is. The kind is display — the mark on every
 * row, the words in the scorer's reasons — and Privy's report of it at link
 * time is often wrong for an account abstraction wallet or a Safe reached
 * through another client, so a person can put it right here.
 *
 * The dialog remounts with each arm (the key below), so the fields start
 * from the arm's own values without an effect copying them in.
 */
export function EditWalletDialog({ arm, onClose, onSave }: EditWalletDialogProps) {
  return arm ? <Form key={arm.id} arm={arm} onClose={onClose} onSave={onSave} /> : null
}

function Form({ arm, onClose, onSave }: { arm: Arm; onClose: () => void; onSave: (arm: Arm, edit: WalletEdit) => Promise<void> }) {
  const [label, setLabel] = useState(arm.label ?? '')
  const [walletType, setWalletType] = useState(arm.walletType)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const changed = (label.trim() || null) !== arm.label || walletType !== arm.walletType

  function dismiss() {
    if (busy) return
    onClose()
  }

  async function save() {
    setBusy(true)
    setError(null)
    try {
      await onSave(arm, { label: label.trim() || null, walletType })
      onClose()
    } catch {
      setError('That did not save. Nothing changed — try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open
      onClose={dismiss}
      title={`Edit ${armName(arm)}`}
      description="The name is yours. The kind sets the mark on every row — it does not change what the wallet can sign."
      actions={
        <>
          <Button variant="ghost" onClick={dismiss} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void save()} disabled={busy || !changed}>
            {busy ? 'Saving…' : 'Save'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <label className="flex flex-col gap-1.5">
          <span className="text-[13px] font-semibold">Name</span>
          <Input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && changed) void save()
            }}
            placeholder={WALLET_NAMES[walletType] ?? 'Wallet'}
            maxLength={60}
            autoComplete="off"
          />
        </label>

        <div className="flex flex-col gap-1.5" role="radiogroup" aria-label="Wallet kind">
          <span className="text-[13px] font-semibold">Kind</span>
          <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
            {EDITABLE_TYPES.map((type) => {
              const on = type === walletType
              return (
                <button
                  key={type}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => setWalletType(type)}
                  className={cn(
                    'flex cursor-pointer items-center gap-2 rounded-[10px] border px-2.5 py-2 text-left text-[13px] transition-colors',
                    'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--ot-plan)]',
                    on
                      ? 'border-[var(--ot-plan)] bg-[var(--ot-plan-bg)] font-semibold text-[var(--ot-text)]'
                      : 'border-[var(--ot-border)] bg-[var(--ot-card)] text-[var(--ot-text-2)] hover:bg-[var(--ot-surface-2)]',
                  )}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={walletMark(type) ?? ''} alt="" width={20} height={20} className="h-5 w-5 flex-none rounded-[6px] object-cover" />
                  <span className="truncate">{WALLET_NAMES[type]}</span>
                </button>
              )
            })}
          </div>
        </div>

        {error ? (
          <p role="alert" className="text-[13px] text-[var(--ot-block-text)]">
            {error}
          </p>
        ) : null}
      </div>
    </Dialog>
  )
}
