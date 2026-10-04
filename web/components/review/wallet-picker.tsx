'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { Button, Dialog, Input } from '@/components/ui'
import {
  DIRECTORY_PAGE_SIZE,
  fetchDirectory,
  sdkWalletFor,
  type DirectoryWallet,
  type InjectedWallet,
  type SdkWallet,
  type WalletLink,
} from './connectors'

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
  /**
   * Wallets whose own window opens here. They need neither an extension nor
   * the registry, so they are listed whatever else is installed or configured.
   */
  sdkWallets: readonly SdkWallet[]
  onPickSdk: (wallet: SdkWallet) => void
  /**
   * The public project id wallets elsewhere are reached with. Null leaves the
   * rows in place but disabled, saying why, rather than sending anyone to
   * another connect surface.
   */
  projectId: string | null
  /** Pair a wallet on another device; null when the person named none. */
  onPair: (wallet: DirectoryWallet | null) => void
}

/**
 * Our own wallet list: what is installed here, the wallets with a window of
 * their own, the wallet on the person's phone, and behind "More wallets" the registry of everything else.
 *
 * It only ever chooses the app. Which account signs is the wallet's question
 * to the person and the gate's to answer afterwards.
 */
export function WalletPicker({
  open,
  onClose,
  needs,
  installed,
  linked,
  onPick,
  links,
  sdkWallets,
  onPickSdk,
  projectId,
  onPair,
}: WalletPickerProps) {
  const [more, setMore] = useState(false)
  const ordered = linked ? [linked, ...installed.filter((w) => w !== linked)] : installed
  const close = () => {
    setMore(false)
    onClose()
  }

  if (more && projectId) {
    return (
      <Dialog open={open} onClose={close} title="More wallets" description="Pick the wallet that holds this account.">
        <Directory
          projectId={projectId}
          skip={installed}
          onPick={(wallet) => {
            setMore(false)
            onPair(wallet)
          }}
        />
        <Button variant="link" size="sm" className="self-center" onClick={() => setMore(false)}>
          Back
        </Button>
      </Dialog>
    )
  }

  return (
    <Dialog open={open} onClose={close} title="Connect a wallet" description={<>This plan needs {needs}.</>}>
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

        {sdkWallets.length > 0 ? (
          <Section title="Web wallets">
            {sdkWallets.map((wallet) => (
              <Row
                key={wallet.connector.id}
                icon={wallet.icon}
                name={wallet.name}
                note="Opens in its own window, nothing to install"
                onClick={() => onPickSdk(wallet)}
              />
            ))}
          </Section>
        ) : null}

        <Section title="Not in this browser">
          <Row
            icon={null}
            name="Phone wallet"
            note={projectId ? 'Scan a code with any wallet app' : 'WalletConnect is not configured'}
            disabled={!projectId}
            onClick={() => onPair(null)}
          />
          <Row
            icon={null}
            name="More wallets"
            note={projectId ? 'Search every wallet' : 'WalletConnect is not configured'}
            disabled={!projectId}
            onClick={() => setMore(true)}
          />
        </Section>
      </div>
    </Dialog>
  )
}

/**
 * The registry, a page at a time, with a search over all of it. Wallets
 * already installed here are left out: they are one click away in the first
 * list and need no pairing. A wallet with a connector of its own stays, since
 * its web account is not the one in the extension.
 */
function Directory({
  projectId,
  skip,
  onPick,
}: {
  projectId: string
  skip: readonly InjectedWallet[]
  onPick: (wallet: DirectoryWallet) => void
}) {
  const [typed, setTyped] = useState('')
  const [search, setSearch] = useState('')
  const [pages, setPages] = useState(1)
  const [list, setList] = useState<{ search: string; wallets: DirectoryWallet[]; total: number } | null>(null)
  const [problem, setProblem] = useState<string | null>(null)

  // A keystroke is not a question yet.
  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(typed.trim())
      setPages(1)
    }, 250)
    return () => clearTimeout(timer)
  }, [typed])

  useEffect(() => {
    const abort = new AbortController()
    void fetchDirectory({ projectId, search, page: pages, signal: abort.signal })
      .then((page) => {
        setProblem(null)
        setList((held) => {
          const kept = held && held.search === search && pages > 1 ? held.wallets : []
          const fresh = page.wallets.filter((w) => !kept.some((k) => k.id === w.id))
          return { search, wallets: [...kept, ...fresh], total: page.total }
        })
      })
      .catch((err: unknown) => {
        if (!abort.signal.aborted) setProblem((err as Error).message || 'The wallet list did not load.')
      })
    return () => abort.abort()
  }, [projectId, search, pages])

  const here = new Set(skip.map((w) => w.rdns))
  const shown = (list?.wallets ?? []).filter((w) => !w.rdns || !here.has(w.rdns) || sdkWalletFor(w.rdns) !== null)
  const loading = !problem && (list === null || list.search !== search)
  const hasMore = list !== null && pages * DIRECTORY_PAGE_SIZE < list.total

  return (
    <div className="flex flex-col gap-2">
      <Input
        type="search"
        aria-label="Search wallets"
        placeholder="Search wallets"
        value={typed}
        onChange={(e) => setTyped(e.target.value)}
      />
      {problem ? (
        <p role="alert" className="m-0 text-[12.5px] text-[var(--ot-warn-text)]">
          {problem}
        </p>
      ) : null}
      <div className="flex max-h-[min(46vh,340px)] flex-col gap-1.5 overflow-y-auto">
        {shown.map((wallet) => (
          <Row key={wallet.id} icon={wallet.icon} name={wallet.name} onClick={() => onPick(wallet)} />
        ))}
        {loading ? (
          <p className="m-0 text-[12.5px] text-[var(--ot-text-2)]">Loading wallets…</p>
        ) : shown.length === 0 && !problem ? (
          <p className="m-0 text-[12.5px] text-[var(--ot-text-2)]">
            No wallet by that name. A phone wallet that is not listed can still scan the code under Phone wallet.
          </p>
        ) : null}
        {hasMore && !loading ? (
          <Button variant="link" size="sm" className="self-center" onClick={() => setPages((p) => p + 1)}>
            Show more
          </Button>
        ) : null}
      </div>
    </div>
  )
}

const ROW =
  'flex min-h-[48px] w-full cursor-pointer items-center gap-3 rounded-[10px] border border-[var(--ot-border)] bg-[var(--ot-surface)] px-3 py-2 text-left text-[var(--ot-text)] no-underline transition-colors hover:border-[var(--ot-border-strong)] disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:border-[var(--ot-border)]'

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[11.5px] text-[var(--ot-text-3)]">{title}</span>
      {children}
    </div>
  )
}

function Row({
  icon,
  name,
  note,
  disabled,
  onClick,
}: {
  icon: string | null
  name: string
  note?: string | undefined
  disabled?: boolean | undefined
  onClick: () => void
}) {
  return (
    <button type="button" className={ROW} disabled={disabled} onClick={onClick}>
      <WalletMark icon={icon} name={name} />
      <span className="flex flex-1 flex-col">
        <span className="text-[14px] font-semibold">{name}</span>
        {note ? <span className="text-[11.5px] text-[var(--ot-text-2)]">{note}</span> : null}
      </span>
    </button>
  )
}

/** The wallet's own icon or the registry's logo for it, or its initial with neither. */
export function WalletMark({ icon, name, size = 28 }: { icon: string | null; name: string; size?: number }) {
  return (
    <span
      className="flex flex-none items-center justify-center overflow-hidden bg-[var(--ot-surface-3)] font-bold text-[var(--ot-text-2)]"
      style={{ width: size, height: size, borderRadius: Math.round(size / 4), fontSize: Math.round(size * 0.43) }}
    >
      {icon ? (
        // eslint-disable-next-line @next/next/no-img-element -- a data URI the wallet announced, or the registry's small logo; nothing to optimise
        <img src={icon} alt="" className="h-full w-full object-cover" />
      ) : (
        name.slice(0, 1)
      )}
    </span>
  )
}
