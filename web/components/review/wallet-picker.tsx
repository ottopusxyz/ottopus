'use client'

import type { ReactNode } from 'react'
import { Dialog } from '@/components/ui'
import type { InjectedWallet } from './injected'
import type { WalletLink } from './wallet-links'

export interface WalletPickerProps {
  open: boolean
  onClose: () => void
  /** The account and chain the plan needs, in words. */
  needs: string
  installed: readonly InjectedWallet[]
  /** The installed wallet the plan's account was linked with, if any. */
  linked: InjectedWallet | null
  onPick: (wallet: InjectedWallet) => void
  /** Wallet apps that can open this page themselves. Empty off a phone. */
  links: readonly WalletLink[]
}

/**
 * Our own wallet list: what is installed here, and on a phone the wallet apps
 * that can open this page themselves.
 *
 * It only ever chooses the app. Which account signs is the wallet's question
 * to the person and the gate's to answer afterwards.
 */
export function WalletPicker({ open, onClose, needs, installed, linked, onPick, links }: WalletPickerProps) {
  const ordered = linked ? [linked, ...installed.filter((w) => w !== linked)] : installed
  return (
    <Dialog open={open} onClose={onClose} title="Connect a wallet" description={<>This plan needs {needs}.</>}>
      <div className="flex flex-col gap-3">
        {ordered.length > 0 ? (
          <Section title="Installed">
            {ordered.map((wallet) => (
              <Row
                key={wallet.rdns}
                icon={wallet.icon}
                name={wallet.name}
                note={wallet === linked ? 'Linked with this account' : undefined}
                onClick={() => onPick(wallet)}
              />
            ))}
          </Section>
        ) : null}

        {links.length > 0 ? (
          <Section title="Open in a wallet app">
            {links.map((link) => (
              <a key={link.type} href={link.href} className={ROW}>
                <WalletMark icon={null} name={link.name} />
                <span className="flex-1 text-[14px] font-semibold">{link.name}</span>
                <span aria-hidden className="text-[var(--ot-text-3)]">↗</span>
              </a>
            ))}
          </Section>
        ) : null}

        {ordered.length === 0 && links.length === 0 ? (
          <p className="m-0 text-[13px] leading-[1.5] text-[var(--ot-text-2)]">
            No wallet found in this browser. Open this page in a browser that has your wallet installed.
          </p>
        ) : null}
      </div>
    </Dialog>
  )
}

const ROW =
  'flex min-h-[48px] w-full cursor-pointer items-center gap-3 rounded-[10px] border border-[var(--ot-border)] bg-[var(--ot-surface)] px-3 py-2 text-left text-[var(--ot-text)] no-underline transition-colors hover:border-[var(--ot-border-strong)]'

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[11.5px] text-[var(--ot-text-3)]">{title}</span>
      {children}
    </div>
  )
}

function Row({ icon, name, note, onClick }: { icon: string | null; name: string; note?: string | undefined; onClick: () => void }) {
  return (
    <button type="button" className={ROW} onClick={onClick}>
      <WalletMark icon={icon} name={name} />
      <span className="flex flex-1 flex-col">
        <span className="text-[14px] font-semibold">{name}</span>
        {note ? <span className="text-[11.5px] text-[var(--ot-text-2)]">{note}</span> : null}
      </span>
    </button>
  )
}

/** The wallet's own icon, or its initial when it gave none. */
export function WalletMark({ icon, name, size = 28 }: { icon: string | null; name: string; size?: number }) {
  return (
    <span
      className="flex flex-none items-center justify-center overflow-hidden bg-[var(--ot-surface-3)] font-bold text-[var(--ot-text-2)]"
      style={{ width: size, height: size, borderRadius: Math.round(size / 4), fontSize: Math.round(size * 0.43) }}
    >
      {icon ? (
        // eslint-disable-next-line @next/next/no-img-element -- a data URI the wallet announced; nothing to optimise
        <img src={icon} alt="" className="h-full w-full object-cover" />
      ) : (
        name.slice(0, 1)
      )}
    </span>
  )
}
