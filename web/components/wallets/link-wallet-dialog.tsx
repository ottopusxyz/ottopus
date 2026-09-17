'use client'

import { useState } from 'react'
import { ApiError } from '@/lib/api'
import { Button, Callout, Dialog, EXIT_MS, Input } from '@/components/ui'
import { ADDRESS_RE, LINK_ERRORS } from './naming'

export interface LinkWalletDialogProps {
  open: boolean
  onClose: () => void
  onConnect: () => void
  onPaste: (input: { address: string; label?: string }) => Promise<void>
  linking: boolean
  linkError: string | null
  /** Arms already in use, so the dialog can say when there is no room. */
  used: number
  max: number
}

/**
 * Two ways in, and they are not equivalent — the dialog says so rather than
 * offering them as interchangeable tabs.
 *
 * Connecting proves ownership: the wallet signs a challenge and the arm can
 * sign transactions. Pasting proves nothing, so the arm is watch-only forever
 * and Ottopus will plan around it but never route a transaction through it.
 * Someone choosing the second option should know that before they choose.
 */
export function LinkWalletDialog({
  open,
  onClose,
  onConnect,
  onPaste,
  linking,
  linkError,
  used,
  max,
}: LinkWalletDialogProps) {
  const [address, setAddress] = useState('')
  const [label, setLabel] = useState('')
  const [pasting, setPasting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  /**
   * Cleared on the way out rather than on the way in. A dialog that remembers
   * the last attempt shows a stale error the next time it opens, and every
   * route out — the buttons, Escape, the backdrop, the sheet drag — arrives
   * here through the Dialog's own onClose.
   */
  function close() {
    setAddress('')
    setLabel('')
    setError(null)
    setPasting(false)
    onClose()
  }

  /**
   * Hand over to Privy only once our own dialog has left the top layer.
   *
   * `showModal()` puts this dialog in the browser's top layer, and the top
   * layer beats z-index absolutely: Privy renders its modal into an ordinary
   * portal, so it paints *underneath* ours and is not hit-testable at all —
   * verified with elementFromPoint against a portal at z-index 2147483647,
   * which still lost. Opening Privy from here without closing first produces a
   * wallet picker nobody can click.
   *
   * The wait covers the exit transition as well, so the handover does not
   * flash. Anything Privy reports afterwards surfaces on the page behind,
   * since this dialog is gone by then.
   */
  function connect() {
    close()
    setTimeout(onConnect, EXIT_MS)
  }

  const trimmed = address.trim()
  const full = used >= max
  const valid = ADDRESS_RE.test(trimmed)
  const showInvalid = trimmed.length > 0 && !valid

  async function submitPaste() {
    if (!valid || pasting) return
    setPasting(true)
    setError(null)
    try {
      await onPaste({ address: trimmed, ...(label.trim() ? { label: label.trim() } : {}) })
      close()
    } catch (err) {
      const code = err instanceof ApiError ? err.code : undefined
      setError((code && LINK_ERRORS[code]) ?? 'That address could not be added.')
    } finally {
      setPasting(false)
    }
  }

  return (
    <Dialog
      open={open}
      onClose={close}
      title="Link a wallet"
      description={`Otto has ${max} arms. ${used} in use.`}
    >
      {full ? (
        <Callout severity="caution" title="All eight arms are full">
          Unlink a wallet before adding another.
        </Callout>
      ) : (
        <div className="flex flex-col gap-5">
          <section className="flex flex-col gap-2">
            <h3 className="text-[14px] font-semibold">Connect a wallet</h3>
            <p className="text-[13px] leading-[1.5] text-[var(--ot-text-2)]">
              You’ll sign a message to prove it’s yours. No transaction, no gas. This is the only
              kind of wallet Ottopus can plan a transaction for.
            </p>
            <Button variant="primary" onClick={connect} disabled={linking} fullWidth>
              {linking ? 'Waiting for your wallet…' : 'Connect a wallet'}
            </Button>
            {linkError ? (
              <p role="alert" className="text-[13px] text-[var(--ot-block-text)]">
                {linkError}
              </p>
            ) : null}
          </section>

          <div aria-hidden className="h-px bg-[var(--ot-border)]" />

          <section className="flex flex-col gap-2">
            <h3 className="text-[14px] font-semibold">Or watch an address</h3>
            <p className="text-[13px] leading-[1.5] text-[var(--ot-text-2)]">
              Paste any address — a Safe, or a wallet you don’t have here. Ottopus will read its
              balances and count it when planning, but it can never sign. That’s permanent.
            </p>
            <Input
              mono
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void submitPaste()
              }}
              placeholder="0x…"
              aria-label="Wallet address"
              invalid={showInvalid}
              autoComplete="off"
              spellCheck={false}
            />
            <Input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void submitPaste()
              }}
              placeholder="Name it (optional) — Treasury, Cold storage"
              aria-label="Label"
              maxLength={60}
            />
            {showInvalid ? (
              <p role="alert" className="text-[13px] text-[var(--ot-block-text)]">
                An address is 42 characters, starting 0x.
              </p>
            ) : null}
            {error ? (
              <p role="alert" className="text-[13px] text-[var(--ot-block-text)]">
                {error}
              </p>
            ) : null}
            <Button
              variant="secondary"
              onClick={() => void submitPaste()}
              disabled={!valid || pasting}
              fullWidth
            >
              {pasting ? 'Adding…' : 'Watch this address'}
            </Button>
          </section>
        </div>
      )}
    </Dialog>
  )
}
