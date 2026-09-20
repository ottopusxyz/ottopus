'use client'

import { useEffect, useMemo, useState } from 'react'
import { usePrivyAvailable } from '@/components/auth'
import { Otto } from '@/components/brand'
import { BubbleField } from '@/components/motion'
import { walletRefsOf } from '@/components/portfolio/wallet-marks'
import { Button, Callout, EmptyState, ErrorState } from '@/components/ui'
import { armsOf, useWallets } from '@/components/wallets'
import type { ChainRow } from '@/lib/api'
import { KIND_FILTERS } from './activity'
import { ActivityTable, ActivityTableSkeleton } from './activity-table'
import { useActivity, type ActivityFailure } from './use-activity'

/**
 * The Activity route: what every linked wallet did on chain, merged.
 *
 * Client-side because the arm list is — it lives behind a Privy session held
 * in the browser. Split the way the other wallet surfaces are: Privy's hooks
 * throw outside their provider, so without one the page draws its frame and
 * an empty feed.
 */
export function ActivityView() {
  return usePrivyAvailable() ? <ConnectedActivity /> : <Empty linked={false} />
}

function ConnectedActivity() {
  const { state: walletsState } = useWallets()
  const wallets = armsOf(walletsState)
  const [kind, setKind] = useState('all')
  const [wallet, setWallet] = useState('all')
  const [chain, setChain] = useState<string | null>(null)
  // A slow clock, so "Today" turns into "Yesterday" at midnight without a reload.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(id)
  }, [])

  const kinds = useMemo(() => KIND_FILTERS.find((f) => f.id === kind)?.kinds ?? null, [kind])
  const filters = useMemo(() => ({ wallet: wallet === 'all' ? null : wallet, chain, kinds }), [wallet, chain, kinds])
  const { state, chains, refresh, loadMore } = useActivity(filters, walletsState.status !== 'loading' && wallets.length > 0)

  const walletRefs = useMemo(() => walletRefsOf(wallets), [wallets])
  const addresses = useMemo(() => new Map(wallets.map((arm) => [arm.id, arm.address])), [wallets])
  const choices = useMemo(
    () => wallets.map((arm) => ({ id: arm.id, label: walletRefs.get(arm.id)?.name ?? arm.address, ref: walletRefs.get(arm.id)! })),
    [wallets, walletRefs],
  )
  const chainRows = useMemo<ChainRow[]>(() => chains.map((c) => ({ chainId: c.chainId, name: c.name, iconUrl: c.iconUrl, value: 0, share: 0 })), [chains])
  const chainIcons = useMemo(() => new Map(chains.flatMap((c) => (c.iconUrl ? [[c.chainId, c.iconUrl] as const] : []))), [chains])

  // If the wallet picked is unlinked while the page is open, the filter falls back to everything.
  const walletValue = wallet === 'all' || wallets.some((arm) => arm.id === wallet) ? wallet : 'all'

  if (walletsState.status !== 'loading' && wallets.length === 0) return <Empty linked={false} />

  if (state.status === 'loading') {
    return (
      <div className="px-5 py-6 sm:px-[26px]">
        <ActivityTableSkeleton />
      </div>
    )
  }

  if (state.status === 'failed') {
    const text = failureText(state.reason)
    return (
      <ErrorState
        title={text.title}
        description={text.body}
        action={
          <Button variant="secondary" onClick={refresh}>
            Try again
          </Button>
        }
      />
    )
  }

  const filtered = kind !== 'all' || walletValue !== 'all' || chain !== null
  const unread = state.arms.filter((arm) => arm.status !== 'ok')

  if (state.rows.length === 0 && !filtered && state.cursor === null) return <Empty linked />

  return (
    <div className="flex flex-col gap-4 px-5 py-6 sm:px-[26px]">
      {unread.length > 0 ? (
        <Callout
          severity="caution"
          title={unread.length === 1 ? 'One wallet could not be read' : `${unread.length} wallets could not be read`}
          actions={
            <Button variant="secondary" size="sm" onClick={refresh}>
              Read again
            </Button>
          }
        >
          {unread.map((arm) => walletRefs.get(arm.walletId)?.name ?? arm.address).join(', ')} — left out of this list until it is read again from the top, so nothing lands out of order.
        </Callout>
      ) : null}
      <ActivityTable
        rows={state.rows}
        chains={chainRows}
        chainIcons={chainIcons}
        wallets={choices}
        walletRefs={walletRefs}
        addresses={addresses}
        kind={kind}
        wallet={walletValue}
        chain={chain}
        onKind={setKind}
        onWallet={setWallet}
        onChain={setChain}
        onMore={state.cursor ? loadMore : null}
        more={state.more}
        now={now}
      />
    </div>
  )
}

function Empty({ linked }: { linked: boolean }) {
  return (
    <div className="px-5 py-6 sm:px-[26px]">
      <div className="ot-canvas relative overflow-hidden rounded-2xl">
        <BubbleField pattern="calm" />
        <EmptyState
          className="relative"
          title={linked ? 'Still water' : 'Nothing to read yet'}
          description={
            linked
              ? 'These wallets have not moved on chain yet. Whatever they do next, from any app, shows up here.'
              : 'Link a wallet on the portfolio page and its history, on every network, shows up here.'
          }
          illustration={<Otto pose="base" size={150} animated />}
        />
      </div>
    </div>
  )
}

function failureText(reason: ActivityFailure): { title: string; body: string } {
  return reason === 'unconfigured'
    ? { title: 'History isn’t switched on', body: 'Your wallets are linked, but their history is temporarily unavailable. Try again later.' }
    : { title: 'Otto couldn’t read your history', body: 'Your wallets are still linked. Try again to read what they did.' }
}
