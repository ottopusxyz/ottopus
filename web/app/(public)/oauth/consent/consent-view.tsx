'use client'

import { useIdentityToken, usePrivy } from '@privy-io/react-auth'
import { useSearchParams } from 'next/navigation'
import { useCallback, useEffect, useState } from 'react'
import { RequireSession, usePrivyAvailable, useSession } from '@/components/auth'
import { OttoBadge } from '@/components/brand'
import { BubbleField } from '@/components/motion'
import { Button, Callout } from '@/components/ui'
import { ApiError, decideConsent, readConsent, type ConsentGrant } from '@/lib/api'

/**
 * The consent screen, per P3.
 *
 * Everything shown is read back from the service against the request id — the
 * agent's name, the scopes, the callback host. Nothing is taken from the query
 * string, because the query string is whatever the last redirect put there and
 * this is the screen where someone decides what an agent may do.
 */
export function ConsentView() {
  return usePrivyAvailable() ? (
    <RequireSession>
      <Consent />
    </RequireSession>
  ) : (
    <Shell>
      <Callout severity="caution" title="Sign-in is not configured">
        This deployment cannot authorize an agent. Nothing has been granted.
      </Callout>
    </Shell>
  )
}

type Decision = 'idle' | 'deciding' | 'leaving'

function Consent() {
  const requestId = useSearchParams().get('request')
  const { getAccessToken } = usePrivy()
  const { identityToken } = useIdentityToken()
  const session = useSession()

  const [grant, setGrant] = useState<ConsentGrant | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const [decision, setDecision] = useState<Decision>('idle')

  // A link with no request id is wrong on arrival, not something that goes
  // wrong later — so it is derived here rather than set from an effect.
  const problem = requestId
    ? failure
    : 'That link is missing its request. Ask the agent to try connecting again.'

  const credentials = useCallback(async () => {
    const accessToken = await getAccessToken()
    if (!accessToken) throw new Error('Not signed in')
    return { accessToken, identityToken }
  }, [getAccessToken, identityToken])

  useEffect(() => {
    if (!requestId) return
    let cancelled = false
    void (async () => {
      try {
        const read = await readConsent(await credentials(), requestId)
        if (!cancelled) setGrant(read)
      } catch (err) {
        if (cancelled) return
        setFailure(problemText(err))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [requestId, credentials])

  const decide = useCallback(
    async (approved: boolean) => {
      if (!requestId) return
      setDecision('deciding')
      setFailure(null)
      try {
        const { redirectTo } = await decideConsent(await credentials(), requestId, approved)
        // Leaving for the agent's own callback, which is off this origin —
        // assign rather than the router, and hold the buttons disabled so a
        // second click cannot land while the navigation is in flight.
        setDecision('leaving')
        window.location.assign(redirectTo)
      } catch (err) {
        setDecision('idle')
        setFailure(problemText(err))
      }
    },
    [requestId, credentials],
  )

  if (problem && !grant) {
    return (
      <Shell>
        <Callout severity="caution" title="This request cannot be approved">
          {problem}
        </Callout>
      </Shell>
    )
  }

  if (!grant) {
    return (
      <Shell>
        <p className="text-center text-[14px] text-[var(--ot-text-2)]">Reading the request…</p>
      </Shell>
    )
  }

  const identity =
    session.status === 'ready' ? (session.user.email ?? session.user.name ?? null) : null
  const busy = decision !== 'idle'

  return (
    <Shell>
      <div className="overflow-hidden rounded-[16px] border border-[var(--ot-border)] bg-[var(--ot-card)] shadow-[var(--ot-shadow-card)]">
        <header className="flex items-center gap-3 border-b border-[var(--ot-border)] px-6 py-[22px]">
          <OttoBadge tier="icon" size={34} />
          <div className="flex min-w-0 flex-col">
            <h1 className="truncate text-[15px] font-semibold">
              {grant.client.name} wants to use Ottopus
            </h1>
            {identity ? (
              <span className="truncate text-[12px] text-[var(--ot-text-3)]">
                Signing in as {identity}
              </span>
            ) : null}
          </div>
        </header>

        <div className="flex flex-col gap-[18px] px-6 py-[22px]">
          <p className="m-0 text-[14px] leading-[1.55] text-[var(--ot-text-2)]">
            This grant lets the agent prepare requests on your behalf. It does not let anything
            move funds — every request still ends with you signing in your own wallet.
          </p>

          <ul className="m-0 flex list-none flex-col gap-px overflow-hidden rounded-[12px] p-0">
            {grant.granted.map((entry) => (
              <li key={entry.scope} className="flex gap-[11px] bg-[var(--ot-water-1)] px-[15px] py-[13px]">
                <span aria-hidden className="flex-none font-bold text-[var(--ot-ok-text)]">
                  ✓
                </span>
                <div className="flex flex-col gap-0.5">
                  <span className="text-[14px] font-semibold">{entry.title}</span>
                  <span className="text-[13px] leading-[1.45] text-[var(--ot-text-2)]">
                    {entry.detail}
                  </span>
                </div>
              </li>
            ))}
            {/* Not a scope that was declined — one that cannot be asked for. The
                row is the product's whole promise, so it is always present. */}
            <li className="flex gap-[11px] bg-[var(--ot-block-bg)] px-[15px] py-[13px]">
              <span aria-hidden className="flex-none font-bold text-[var(--ot-block-text)]">
                ✕
              </span>
              <div className="flex flex-col gap-0.5">
                <span className="text-[14px] font-semibold text-[var(--ot-block-text)]">
                  {grant.neverGranted.title}
                </span>
                <span className="text-[13px] leading-[1.45] text-[var(--ot-text)]">
                  {grant.neverGranted.detail}
                </span>
              </div>
            </li>
          </ul>

          <div className="flex items-center justify-between gap-3 rounded-[10px] border border-dashed border-[var(--ot-border-strong)] px-[15px] py-3 text-[13px]">
            <span className="text-[var(--ot-text-2)]">Grant expires</span>
            <span className="font-semibold">In 90 days, or when you revoke it</span>
          </div>

          {problem ? (
            <Callout severity="caution" title="That did not go through">
              {problem}
            </Callout>
          ) : null}

          <div className="flex flex-col gap-[9px]">
            <Button variant="primary" size="lg" fullWidth disabled={busy} onClick={() => decide(true)}>
              {decision === 'idle' ? 'Allow access' : 'Working…'}
            </Button>
            <Button variant="secondary" size="md" fullWidth disabled={busy} onClick={() => decide(false)}>
              Deny
            </Button>
          </div>

          <p className="m-0 text-center text-[12px] leading-[1.5] text-[var(--ot-text-3)]">
            You will be returned to{' '}
            <code className="font-mono text-[11px]">{grant.client.redirectHost}</code>. Revoke any
            time in settings.
          </p>
        </div>
      </div>
    </Shell>
  )
}

/** The page's ground: water, and one card centred on it. */
function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="ot-canvas relative flex min-h-dvh items-center justify-center overflow-hidden px-5 py-11">
      <BubbleField pattern="calm" />
      <div className="relative w-full max-w-[520px]">{children}</div>
    </main>
  )
}

function problemText(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.code === 'expired') {
      return 'This request has expired. Ask the agent to connect again.'
    }
    if (err.code === 'already_decided' || err.code === 'not_pending') {
      return 'This request was already answered. Ask the agent to connect again.'
    }
    if (err.status === 404) {
      return 'We do not have that request. Ask the agent to connect again.'
    }
    if (err.status === 503) {
      return 'This deployment is not set up to authorize agents yet.'
    }
  }
  return 'Ottopus could not be reached. Nothing has been granted.'
}
