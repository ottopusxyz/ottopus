import { cn } from '@/lib/cn'
import type { WalletFace } from './connectors'
import type { SignerStatus } from './wallet-gate'
import { WalletMark } from './wallet-picker'

export interface SignerChipProps {
  status: SignerStatus
  /** The connected wallet; null draws the empty socket. */
  wallet: WalletFace | null
  /** Lets go of the connected wallet. Left out, there is nothing to disconnect. */
  onDisconnect?: (() => void) | undefined
  disabled?: boolean
}

/**
 * The wallet strip under the buttons: what is connected, whether it may sign,
 * and the way out, in one shape for every gate. Quiet on purpose: the state
 * is carried by a small mark and the note's colour, never by a fill, so the
 * buttons above stay the loudest thing in the panel.
 */
export function SignerChip({ status, wallet, onDisconnect, disabled }: SignerChipProps) {
  return (
    <div
      role="status"
      className="flex items-center gap-2.5 rounded-[10px] border border-[var(--ot-border)] py-1.5 pr-1.5 pl-2.5"
    >
      {wallet ? <WalletMark icon={wallet.icon} name={wallet.name} size={26} /> : <Socket />}
      <div className="flex min-w-0 flex-1 flex-col gap-px">
        <span className="truncate text-[12.5px] font-semibold leading-[1.35] text-[var(--ot-text)]">{status.title}</span>
        <span
          className={cn(
            'flex items-start gap-1 text-[11.5px] leading-[1.4]',
            status.tone === 'ok'
              ? 'text-[var(--ot-ok-text)]'
              : status.tone === 'warn'
                ? 'text-[var(--ot-warn-text)]'
                : 'text-[var(--ot-text-2)]',
          )}
        >
          {status.tone === 'ok' ? <Tick /> : status.tone === 'warn' ? <Warning /> : null}
          <span className="min-w-0">{status.note}</span>
        </span>
      </div>
      {wallet && onDisconnect ? (
        <button
          type="button"
          disabled={disabled}
          onClick={onDisconnect}
          aria-label={`Disconnect ${wallet.name}`}
          title={`Disconnect ${wallet.name}`}
          className="flex h-8 w-8 flex-none cursor-pointer items-center justify-center rounded-[8px] border-0 bg-transparent text-[var(--ot-text-3)] transition-colors hover:bg-[var(--ot-surface-3)] hover:text-[var(--ot-text)] disabled:cursor-default disabled:opacity-50"
        >
          <Unplug />
        </button>
      ) : null}
    </div>
  )
}

const MARK = 'mt-[2px] h-3 w-3 flex-none'

function Tick() {
  return (
    <svg aria-hidden viewBox="0 0 12 12" className={MARK} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="6" cy="6" r="5" />
      <path d="M3.8 6.2l1.5 1.5 2.9-3.2" />
    </svg>
  )
}

function Warning() {
  return (
    <svg aria-hidden viewBox="0 0 12 12" className={MARK} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 1.4l4.9 8.8H1.1z" />
      <path d="M6 4.9v2.3M6 8.7v.1" />
    </svg>
  )
}

/** The wallet's place before there is one. */
function Socket() {
  return (
    <span className="flex h-[26px] w-[26px] flex-none items-center justify-center rounded-[7px] border border-dashed border-[var(--ot-border-strong)] text-[var(--ot-text-3)]">
      <svg aria-hidden viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
        <rect x="1.8" y="3.6" width="12.4" height="9.4" rx="2" />
        <path d="M10.4 8.3h3.8" />
      </svg>
    </span>
  )
}

/** A link coming apart. */
function Unplug() {
  return (
    <svg aria-hidden viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6.6 4.3l1-1a3.1 3.1 0 014.4 4.4l-1 1M9.4 11.7l-1 1a3.1 3.1 0 01-4.4-4.4l1-1" />
      <path d="M3.2 2.6l1.2 1.2M12.8 13.4l-1.2-1.2M2 5.6h1.4M14 10.4h-1.4" />
    </svg>
  )
}
