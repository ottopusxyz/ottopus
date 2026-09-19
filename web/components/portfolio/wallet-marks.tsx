import { armName, walletMark } from '@/components/wallets/naming'
import type { Arm } from '@/lib/api'
import { cn } from '@/lib/cn'
import { AssetIcon } from './asset-icon'

/** What a row knows about a wallet: enough to name it and draw it. */
export interface WalletRef {
  id: string
  name: string
  icon: string | null
  /** Set by the person, so its first letter stands for it. */
  label: string | null
  watchOnly: boolean
}

/** The arms as rows see them, keyed by id. */
export function walletRefsOf(wallets: readonly Arm[]): Map<string, WalletRef> {
  return new Map(wallets.map((arm) => [
    arm.id,
    {
      id: arm.id,
      name: armName(arm),
      icon: walletMark(arm.walletType),
      label: arm.label,
      watchOnly: arm.isWatchOnly,
    },
  ]))
}

const UNLINKED: Omit<WalletRef, 'id'> = { name: 'Unlinked wallet', icon: null, label: null, watchOnly: false }

/** A wallet by id, or a stand-in for one the arm list no longer has. */
export function walletRefOf(lookup: ReadonlyMap<string, WalletRef>, id: string): WalletRef {
  return lookup.get(id) ?? { id, ...UNLINKED }
}

/**
 * A wallet's mark, in three forms: the client's bundled mark (public/wallets,
 * keyed by the type stored on the arm — the same on every device); an eye for
 * a watch-only address, because "watched, not held" is the fact about it that
 * matters, whatever it is called; else the first letter of its name, for a
 * client we have no mark for. One glyph per circle — AssetIcon's two-letter
 * fallback sat off the baseline beside real images and read as a ticker.
 */
export function WalletMark({ wallet, size, className }: { wallet: WalletRef; size: number; className?: string }) {
  const eye = wallet.watchOnly
  if (wallet.icon && !eye) return <AssetIcon url={wallet.icon} name={wallet.name} size={size} className={className} />
  return (
    <span aria-hidden style={{ width: size, height: size }}
      className={cn('inline-flex shrink-0 items-center justify-center rounded-full bg-[var(--ot-surface-3)] font-semibold leading-none text-[var(--ot-text-2)] ring-1 ring-[var(--ot-border)]', className)}>
      {eye ? (
        <svg viewBox="0 0 16 16" width={size * 0.7} height={size * 0.7} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          <path d="M1.6 8s2.4-4 6.4-4 6.4 4 6.4 4-2.4 4-6.4 4S1.6 8 1.6 8Z" />
          <circle cx="8" cy="8" r="1.6" />
        </svg>
      ) : (
        <span style={{ fontSize: Math.round(size * 0.55) }}>{(wallet.label ?? wallet.name).trim().charAt(0).toUpperCase()}</span>
      )}
    </span>
  )
}

/**
 * The wallets holding some part of a token, most first, summed across
 * holdings — a wallet with two rows of the same asset holds their sum here.
 */
export function holdersOf(
  holdings: readonly { walletId: string; amount: string }[],
  lookup: ReadonlyMap<string, WalletRef>,
): (WalletRef & { amount: bigint })[] {
  const sums = new Map<string, bigint>()
  for (const holding of holdings) {
    sums.set(holding.walletId, (sums.get(holding.walletId) ?? 0n) + BigInt(holding.amount))
  }
  return [...sums]
    .sort((a, b) => (b[1] > a[1] ? 1 : b[1] < a[1] ? -1 : 0))
    .map(([id, amount]) => ({ ...walletRefOf(lookup, id), amount }))
}

/**
 * Who holds it, beside the balance: the wallets' own marks, overlapping the
 * way the network strip does. The names ride on the title and for a screen
 * reader; the words are in the breakdown, where there is room for them.
 */
export function WalletMarks({ holders }: { holders: readonly WalletRef[] }) {
  if (holders.length === 0) return null
  const names = holders.map((wallet) => wallet.name)
  const extra = holders.length - 3
  return (
    <span
      title={names.join(', ')}
      aria-label={`Held in ${names.join(', ')}`}
      className="isolate flex shrink-0 items-center -space-x-1"
    >
      {holders.slice(0, 3).map((wallet, index) => (
        <span key={wallet.id} className="relative" style={{ zIndex: 3 - index }}>
          <WalletMark wallet={wallet} size={16} className="ring-2 ring-[var(--ot-card)]" />
        </span>
      ))}
      {extra > 0 ? (
        <span className="relative z-0 ml-1 pl-1.5 text-[10px] font-medium text-[var(--ot-text-3)]">+{extra}</span>
      ) : null}
    </span>
  )
}
