'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { getAddress, isAddress } from 'viem'
import { Otto } from '@/components/brand'
import { Button, Dialog, Input } from '@/components/ui'
import { walletMark } from '@/components/wallets/naming'
import { cn } from '@/lib/cn'
import { addressOf } from '@/lib/format'
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
  /** The account the plan signs from, CAIP-10 or bare. */
  account: string
  /** The name the person gave that account, if any. */
  accountLabel?: string | undefined
  /** The chain the plan runs on, in words. */
  chainName: string
  installed: readonly InjectedWallet[]
  /** The installed wallet the plan's account was linked with, if any. */
  linked: InjectedWallet | null
  onPick: (wallet: InjectedWallet) => void
  /** Wallet apps that can open this page themselves. Empty off a phone. */
  links: readonly WalletLink[]
  /** The wallet kind the plan's account was linked with, to lead the app links. */
  linkedType?: string | undefined
  /**
   * Wallets whose own window opens here. They need neither an extension nor
   * the registry, so they are listed whatever else is installed or configured.
   */
  sdkWallets: readonly SdkWallet[]
  /** The web wallet the plan's account was linked with, if any. */
  linkedSdk: SdkWallet | null
  onPickSdk: (wallet: SdkWallet) => void
  /**
   * The public project id wallets elsewhere are reached with. Null leaves the
   * tiles in place but disabled, saying why, rather than sending anyone to
   * another connect surface.
   */
  projectId: string | null
  /** Pair a wallet on another device; null when the person named none. */
  onPair: (wallet: DirectoryWallet | null) => void
}

/**
 * Our own wallet list, as tiles: the wallet the account was linked with on its
 * own above the rest, then what is installed here, the wallet apps a phone can
 * hand the page to, the wallets with a window of their own, and below them the
 * ways to a wallet somewhere else.
 *
 * The linked wallet carries the one emphasis border and the one coral action
 * in the view, as the chosen arm does everywhere else.
 *
 * It only ever chooses the app. Which account signs is the wallet's question
 * to the person and the gate's to answer afterwards.
 */
export function WalletPicker({
  open,
  onClose,
  account,
  accountLabel,
  chainName,
  installed,
  linked,
  onPick,
  links,
  linkedType,
  sdkWallets,
  linkedSdk,
  onPickSdk,
  projectId,
  onPair,
}: WalletPickerProps) {
  const [more, setMore] = useState(false)
  const close = () => {
    setMore(false)
    onClose()
  }
  // With an app link to offer, this is a phone, and the code is for another screen.
  const pairName = links.length > 0 ? 'Other device' : 'Phone wallet'

  if (more && projectId) {
    return (
      <Dialog
        open={open}
        onClose={close}
        size="wide"
        className={TALL}
        title="More wallets"
        description="Pick the wallet that holds this account. You'll pair it with a code."
      >
        <button type="button" className={BACK} onClick={() => setMore(false)}>
          <Chevron />
          All options
        </button>
        <Directory
          projectId={projectId}
          skip={installed}
          pairName={pairName}
          onPick={(wallet) => {
            setMore(false)
            onPair(wallet)
          }}
          onCode={() => {
            setMore(false)
            onPair(null)
          }}
        />
      </Dialog>
    )
  }

  // One wallet leads: the installed one the account was linked with, else its
  // web wallet, else, on a phone, its app.
  const linkedLink = !linked && !linkedSdk ? (links.find((l) => l.type === linkedType) ?? null) : null
  const otherInstalled = installed.filter((w) => w !== linked)
  const otherLinks = links.filter((l) => l !== linkedLink)
  // The web wallet stays in its section unless it is the one leading: an
  // extension that leads is a different account from the passkey one.
  const otherSdk = linked ? sdkWallets : sdkWallets.filter((w) => w !== linkedSdk)

  return (
    <Dialog
      open={open}
      onClose={close}
      size="wide"
      className={TALL}
      title="Connect a wallet"
      description={<Signs account={account} label={accountLabel} chainName={chainName} />}
    >
      {linked ? (
        <Featured icon={linked.icon} name={linked.name} action="Connect" onClick={() => onPick(linked)} />
      ) : linkedSdk ? (
        <Featured icon={linkedSdk.icon} name={linkedSdk.name} action="Connect" onClick={() => onPickSdk(linkedSdk)} />
      ) : linkedLink ? (
        <Featured icon={walletMark(linkedLink.type)} name={linkedLink.name} action="Open" href={linkedLink.href} />
      ) : null}

      {otherInstalled.length > 0 ? (
        <Section title="In this browser" hint="Extensions found here">
          <Grid>
            {otherInstalled.map((wallet) => (
              <Tile key={wallet.rdns} icon={wallet.icon} name={wallet.name} onClick={() => onPick(wallet)} />
            ))}
          </Grid>
        </Section>
      ) : installed.length === 0 && links.length === 0 ? (
        <Section title="In this browser">
          <p className="m-0 rounded-[10px] bg-[var(--ot-surface-2)] px-3.5 py-3 text-[13.5px] leading-[1.45] text-[var(--ot-text-2)]">
            No wallet extension in this browser.
            {otherSdk.length > 0
              ? ' A web wallet below works without one.'
              : linkedSdk
                ? ` ${linkedSdk.name} above works without one.`
                : null}
          </p>
        </Section>
      ) : null}

      {otherLinks.length > 0 ? (
        <Section title="Open in a wallet app" hint="Leaves this page">
          <Grid>
            {otherLinks.map((link) => (
              <Tile key={link.type} icon={walletMark(link.type)} name={link.name} href={link.href} />
            ))}
          </Grid>
        </Section>
      ) : null}

      {otherSdk.length > 0 ? (
        <Section title="Web wallets" hint="Open in a window, nothing to install">
          <Grid>
            {otherSdk.map((wallet) => (
              <Tile key={wallet.connector.id} icon={wallet.icon} name={wallet.name} onClick={() => onPickSdk(wallet)} />
            ))}
          </Grid>
        </Section>
      ) : null}

      {/* One step deeper: the depth tint is the only cue, no rule above it. */}
      <div className="-mx-[18px] -mb-[var(--ot-dialog-pad-bottom)] flex flex-col gap-2.5 bg-[var(--ot-water-1)] px-[18px] pt-4 pb-[var(--ot-dialog-pad-bottom)] sm:-mx-[22px] sm:rounded-b-[16px] sm:px-[22px]">
        <SectionHead title="Somewhere else" hint="On your phone, or not listed" />
        {projectId ? null : (
          <div className="flex gap-3.5 rounded-[10px] bg-[var(--ot-warn-bg)] p-4">
            <Otto pose="heads-up" size={44} className="flex-none" />
            <div className="flex flex-col gap-1">
              <span className="text-[15px] font-semibold text-[var(--ot-warn-text)]">Pairing is off on this site.</span>
              <span className="text-[14px] leading-[1.5] text-[var(--ot-text)]">
                Phone wallets and the full wallet list need it. Use a wallet above, or open this page where your wallet is
                installed.
              </span>
            </div>
          </div>
        )}
        <div className="grid grid-cols-2 gap-2.5">
          <Wide
            icon={<QrIcon />}
            name={pairName}
            note={links.length > 0 ? 'Show a code' : 'Scan a code'}
            disabled={!projectId}
            onClick={() => onPair(null)}
          />
          <Wide
            icon={<SearchIcon />}
            name="More wallets"
            note="Search every wallet"
            disabled={!projectId}
            onClick={() => setMore(true)}
          />
        </div>
      </div>
    </Dialog>
  )
}

/** The account the plan signs from, shown as the design shows an address: checksummed, 6 + 4, mono. */
function Signs({ account, label, chainName }: { account: string; label?: string | undefined; chainName: string }) {
  const raw = addressOf(account)
  const shown = isAddress(raw) ? getAddress(raw) : raw
  return (
    <span className="flex flex-wrap items-center gap-2 text-[14px]">
      <span>This plan signs from</span>
      <span className="inline-flex items-center gap-2 rounded-[8px] bg-[var(--ot-surface-2)] px-2.5 py-1">
        <span aria-hidden className="h-3.5 w-3.5 flex-none rounded-full bg-[var(--ot-text)]" />
        <span className="font-mono text-[13px] font-medium text-[var(--ot-text)]">
          {shown.slice(0, 6)}
          <span className="text-[var(--ot-text-4)]">…</span>
          {shown.slice(-4)}
        </span>
        {label ? <span className="text-[12px] font-medium text-[var(--ot-text-2)]">{label}</span> : null}
      </span>
      <span className="rounded-[8px] bg-[var(--ot-surface-3)] px-2.5 py-1 text-[12px] font-medium text-[var(--ot-text-2)]">
        {chainName}
      </span>
    </span>
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
  pairName,
  onPick,
  onCode,
}: {
  projectId: string
  skip: readonly InjectedWallet[]
  /** What the pairing tile is called on this device, to send the person back to it. */
  pairName: string
  onPick: (wallet: DirectoryWallet) => void
  onCode: () => void
}) {
  const [typed, setTyped] = useState('')
  const [search, setSearch] = useState('')
  const [pages, setPages] = useState(1)
  const [list, setList] = useState<{ search: string; pages: number; wallets: DirectoryWallet[]; total: number } | null>(null)
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
          return { search, pages, wallets: [...kept, ...fresh], total: page.total }
        })
      })
      .catch((err: unknown) => {
        if (!abort.signal.aborted) setProblem((err as Error).message || 'The wallet list did not load.')
      })
    return () => abort.abort()
  }, [projectId, search, pages])

  const here = new Set(skip.map((w) => w.rdns))
  const shown = (list?.wallets ?? []).filter((w) => !w.rdns || !here.has(w.rdns) || sdkWalletFor(w.rdns) !== null)
  // A new search starts empty; a further page keeps what is already shown.
  const loading = !problem && (list === null || list.search !== search || list.pages !== pages)
  const hasMore = list !== null && pages * DIRECTORY_PAGE_SIZE < list.total
  const empty = !loading && !problem && shown.length === 0

  return (
    <div className="flex flex-col gap-3">
      <Input
        type="search"
        aria-label="Search wallets"
        placeholder="Search wallets"
        value={typed}
        onChange={(e) => setTyped(e.target.value)}
      />
      {problem ? (
        <p role="alert" className="m-0 text-[13px] text-[var(--ot-warn-text)]">
          {problem}
        </p>
      ) : null}
      {empty ? (
        <div className="flex flex-col items-center gap-2.5 rounded-[12px] bg-gradient-to-b from-[var(--ot-water-1)] via-[var(--ot-water-2)] to-[var(--ot-water-3)] px-5 pt-7 pb-6 text-center">
          <Otto pose="base" size={96} animated />
          <span className="font-display text-[18px] font-bold">No wallet by that name</span>
          <span className="max-w-[32ch] text-[14px] leading-[1.5] text-[var(--ot-text-2)]">
            A wallet that isn&apos;t listed can still pair. Any wallet app can scan the code.
          </span>
          <Button variant="secondary" size="sm" className="mt-1" onClick={onCode}>
            Show a code instead
          </Button>
        </div>
      ) : (
        <div className="max-h-[min(46vh,360px)] overflow-y-auto">
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
            {shown.map((wallet) => (
              <Tile key={wallet.id} icon={wallet.icon} name={wallet.name} compact onClick={() => onPick(wallet)} />
            ))}
            {loading ? [0, 1, 2, 3].map((i) => <Shoal key={i} />) : null}
          </div>
        </div>
      )}
      {hasMore && !loading ? (
        <Button variant="secondary" size="sm" className="self-center" onClick={() => setPages((p) => p + 1)}>
          Show more
        </Button>
      ) : null}
      {empty ? null : (
        <p className="m-0 rounded-[10px] bg-[var(--ot-water-1)] px-3.5 py-3 text-[13px] leading-[1.5] text-[var(--ot-text-2)]">
          Not listed? Go back and choose <span className="font-semibold text-[var(--ot-text)]">{pairName}</span>. Any
          wallet app can scan the code.
        </p>
      )}
    </div>
  )
}

const TILE =
  'relative cursor-pointer rounded-[12px] border border-[var(--ot-border)] bg-[var(--ot-card)] text-[var(--ot-text)] no-underline transition-colors duration-[var(--ot-dur-fast)] hover:border-[var(--ot-border-strong)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ot-plan)] disabled:cursor-not-allowed disabled:bg-[var(--ot-surface-2)] disabled:text-[var(--ot-text-3)] disabled:hover:border-[var(--ot-border)]'

// The tallest dialog in the product: on a short screen it scrolls rather than losing its top.
const TALL =
  '[&_.ot-dialog-panel]:max-h-[calc(100dvh-1.5rem)] [&_.ot-dialog-panel]:overflow-y-auto [&_.ot-dialog-panel]:overscroll-contain'

const BACK =
  'inline-flex cursor-pointer items-center gap-1.5 self-start rounded-[var(--ot-radius-pill)] border border-[var(--ot-border-strong)] bg-[var(--ot-card)] py-[7px] pr-3.5 pl-2.5 text-[13px] font-semibold text-[var(--ot-text)] transition-colors hover:bg-[var(--ot-surface-2)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ot-plan)]'

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2.5">
      <SectionHead title={title} hint={hint} />
      {children}
    </section>
  )
}

function SectionHead({ title, hint }: { title: string; hint?: string | undefined }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <h3 className="m-0 text-[13.5px] font-semibold">{title}</h3>
      {hint ? <span className="text-right text-[12.5px] text-[var(--ot-text-3)]">{hint}</span> : null}
    </div>
  )
}

function Grid({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-3 gap-2 sm:gap-2.5">{children}</div>
}

/** The wallet the account was linked with: the chosen arm, so the one navy border in the view. */
function Featured({
  icon,
  name,
  action,
  href,
  onClick,
}: {
  icon: string | null
  name: string
  action: string
  href?: string
  onClick?: () => void
}) {
  const body = (
    <>
      <WalletMark icon={icon} name={name} size={44} />
      <span className="flex min-w-0 flex-1 flex-col gap-[3px]">
        <span className="truncate text-[15px] font-semibold">{name}</span>
        <span className="text-[13px] leading-[1.4] text-[var(--ot-text-2)]">Linked with this account</span>
      </span>
      <span className="inline-flex flex-none items-center gap-1.5 rounded-[var(--ot-radius-pill)] bg-[var(--ot-coral)] px-4 py-[9px] text-[14px] font-semibold text-[var(--ot-on-state)]">
        {action}
        {href ? <OutIcon /> : null}
      </span>
    </>
  )
  const className = cn(
    TILE,
    'flex w-full items-center gap-3.5 border-2 border-[var(--ot-text)] py-3.5 pr-3.5 pl-4 text-left hover:border-[var(--ot-text)]',
  )
  return href ? (
    <a href={href} className={className}>
      {body}
    </a>
  ) : (
    <button type="button" className={className} onClick={onClick}>
      {body}
    </button>
  )
}

/** A wallet as a tile: its mark over its name. A link leaves the page, and says so in the corner. */
function Tile({
  icon,
  name,
  href,
  compact = false,
  onClick,
}: {
  icon: string | null
  name: string
  href?: string
  compact?: boolean
  onClick?: () => void
}) {
  const className = cn(
    TILE,
    'flex flex-col items-center justify-center text-center',
    compact ? 'min-h-[92px] gap-2 px-1.5 pt-3 pb-2.5' : 'min-h-[100px] gap-2.5 px-2 pt-3.5 pb-3 sm:min-h-[104px]',
  )
  const body = (
    <>
      <WalletMark icon={icon} name={name} size={compact ? 36 : 40} />
      <span className={cn('leading-[1.25] font-semibold', compact ? 'text-[12.5px]' : 'text-[14px]')}>{name}</span>
    </>
  )
  return href ? (
    <a href={href} className={className}>
      <span className="absolute top-2 right-2 text-[var(--ot-text-3)]">
        <OutIcon />
      </span>
      {body}
    </a>
  ) : (
    <button type="button" className={className} onClick={onClick}>
      {body}
    </button>
  )
}

/** A way to a wallet that is not a wallet itself: an icon, a name and what it does. */
function Wide({
  icon,
  name,
  note,
  disabled,
  onClick,
}: {
  icon: ReactNode
  name: string
  note: string
  disabled: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      className={cn(TILE, 'flex min-h-[64px] items-center gap-3 p-3 text-left')}
      disabled={disabled}
      onClick={onClick}
    >
      <span className="flex h-[38px] w-[38px] flex-none items-center justify-center rounded-[10px] bg-[var(--ot-surface-3)]">
        {icon}
      </span>
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="text-[14px] font-semibold">{name}</span>
        {!disabled ? <span className="text-[12.5px] text-[var(--ot-text-2)]">{note}</span> : null}
      </span>
    </button>
  )
}

/** A tile the next page of the registry will fill: the slow tide, at the tile's own height. */
function Shoal() {
  return (
    <span aria-hidden className="relative block min-h-[92px] overflow-hidden rounded-[12px] bg-[var(--ot-water-1)]">
      <span className="ot-tide absolute inset-y-0 left-0 w-1/3 bg-gradient-to-r from-transparent via-[var(--ot-water-3)] to-transparent" />
    </span>
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

function Chevron() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M10 3L5 8l5 5" />
    </svg>
  )
}

function OutIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M4 2h6v6M10 2L3 9" />
    </svg>
  )
}

function QrIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="3" y="3" width="5" height="5" rx="1" />
      <rect x="12" y="3" width="5" height="5" rx="1" />
      <rect x="3" y="12" width="5" height="5" rx="1" />
      <path d="M12 12h2v2h-2zM16.5 16.5h.5M12 17h1M17 12v1" />
    </svg>
  )
}

function SearchIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
      <circle cx="9" cy="9" r="5.5" />
      <path d="M13 13l4 4" />
    </svg>
  )
}
