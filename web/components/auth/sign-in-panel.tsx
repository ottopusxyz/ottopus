'use client'

import { useLoginWithEmail, useLoginWithOAuth, usePrivy } from '@privy-io/react-auth'
import { useState, type FormEvent } from 'react'
import { Otto } from '@/components/brand'
import { Button, Callout, Input } from '@/components/ui'
import { cn } from '@/lib/cn'
import { usePrivyAvailable } from './privy-provider'

/**
 * Google's mark, in Google's colours. It is the one logo here that may not be
 * restyled to match the palette — brand terms, and a recoloured G reads as a
 * phishing page to anyone who notices.
 */
function GoogleMark() {
  return (
    <svg className="h-[18px] w-[18px] shrink-0" viewBox="0 0 24 24" aria-hidden>
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
      />
    </svg>
  )
}

/** Privy's own errors are developer-facing. These are the ones a person reads. */
function readable(error: Error | null, fallback: string): string {
  const raw = error?.message ?? ''
  if (/invalid|incorrect/i.test(raw)) return 'That code did not match. Check it and try again.'
  if (/expired/i.test(raw)) return 'That code has expired. Send a new one.'
  if (/too many|rate/i.test(raw)) return 'Too many attempts. Wait a moment, then send a new code.'
  return fallback
}

export interface SignInPanelProps {
  /** The page uses h1; the dialog uses h2 under its own labelling. */
  headingAs?: 'h1' | 'h2'
  headingId?: string
  title?: string
  className?: string
}

/**
 * The sign-in surface, and the whole of it — the dialog and /signin render this
 * same component so the two cannot drift into saying different things about
 * what signing in means.
 *
 * Email and Google are ours, on Privy's headless hooks, because they are the
 * part a person reads. The wallet step opens Privy's own modal: it is one tap
 * on a surface people already know, and their EIP-6963 detection and connector
 * handling are the parts genuinely worth borrowing.
 */
export function SignInPanel(props: SignInPanelProps) {
  // The hooks below require Privy's context, and calling them without it throws.
  // Splitting on availability here is what keeps that impossible.
  return usePrivyAvailable() ? <LiveSignIn {...props} /> : <UnconfiguredSignIn {...props} />
}

function UnconfiguredSignIn({
  headingAs: Heading = 'h2',
  headingId,
  title = 'Sign in to Ottopus',
  className,
}: SignInPanelProps) {
  return (
    <div className={cn('flex flex-col gap-4', className)}>
      <Heading id={headingId} className="font-display text-[22px] font-bold">
        {title}
      </Heading>
      <Callout severity="caution" title="Sign-in is not available">
        Privy is not configured for this deployment, so there is nothing to sign in to yet.
      </Callout>
    </div>
  )
}

function LiveSignIn({
  headingAs: Heading = 'h2',
  headingId,
  title = 'Sign in to Ottopus',
  className,
}: SignInPanelProps) {
  const { login } = usePrivy()
  const { sendCode, loginWithCode, state: emailState } = useLoginWithEmail()
  const { initOAuth, state: oauthState } = useLoginWithOAuth()

  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')

  const sending = emailState.status === 'sending-code'
  const submitting = emailState.status === 'submitting-code'
  const awaitingCode = emailState.status === 'awaiting-code-input' || submitting
  const oauthBusy = oauthState.status === 'loading'
  const busy = sending || submitting || oauthBusy

  const emailError =
    emailState.status === 'error'
      ? readable(emailState.error, 'That did not work. Try again.')
      : null
  const oauthError = oauthState.status === 'error' ? 'Google sign-in did not complete.' : null

  const onSendCode = async (e: FormEvent) => {
    e.preventDefault()
    await sendCode({ email }).catch(() => {})
  }

  const onVerify = async (e: FormEvent) => {
    e.preventDefault()
    await loginWithCode({ code }).catch(() => {})
  }

  return (
    <div className={cn('flex flex-col items-center gap-5 text-center', className)}>
      <Otto pose="plan-ready" size={96} animated />

      <div className="flex flex-col gap-2">
        <Heading
          id={headingId}
          className="font-display text-[22px] font-bold tracking-[-0.02em]"
        >
          {title}
        </Heading>
        <p className="max-w-[34ch] text-[14px] leading-[1.5] text-[var(--ot-text-2)]">
          Link your wallets once, then tell any agent what you want. You still sign everything
          yourself.
        </p>
      </div>

      {awaitingCode ? (
        <form onSubmit={onVerify} className="flex w-full flex-col gap-3">
          <p className="text-[13px] text-[var(--ot-text-2)]">
            We sent a code to <span className="font-medium text-[var(--ot-text)]">{email}</span>.
          </p>
          <Input
            mono
            name="code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="6-digit code"
            inputMode="numeric"
            autoComplete="one-time-code"
            aria-label="One-time code"
            autoFocus
            required
            invalid={Boolean(emailError)}
          />
          <Button type="submit" variant="primary" size="md" disabled={submitting || !code}>
            {submitting ? 'Checking…' : 'Continue'}
          </Button>
          <Button
            type="button"
            variant="link"
            size="sm"
            onClick={() => {
              setCode('')
              setEmail('')
              window.location.reload()
            }}
          >
            Use a different email
          </Button>
        </form>
      ) : (
        <form onSubmit={onSendCode} className="flex w-full flex-col gap-3">
          <Input
            type="email"
            name="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            autoComplete="email"
            aria-label="Email address"
            required
            invalid={Boolean(emailError)}
          />
          <Button type="submit" variant="primary" size="md" disabled={busy || !email}>
            {sending ? 'Sending a code…' : 'Continue with email'}
          </Button>
        </form>
      )}

      {emailError ? (
        <p role="alert" className="text-[13px] text-[var(--ot-block-text)]">
          {emailError}
        </p>
      ) : null}

      {awaitingCode ? null : (
        <>
          <div className="flex w-full items-center gap-3" aria-hidden>
            <span className="h-px flex-1 bg-[var(--ot-border)]" />
            <span className="text-[12px] text-[var(--ot-text-3)]">or</span>
            <span className="h-px flex-1 bg-[var(--ot-border)]" />
          </div>

          <div className="flex w-full flex-col gap-2">
            <Button
              variant="secondary"
              size="md"
              disabled={busy}
              onClick={() => initOAuth({ provider: 'google' }).catch(() => {})}
            >
              <GoogleMark />
              {oauthBusy ? 'Taking you to Google…' : 'Continue with Google'}
            </Button>
            <Button
              variant="secondary"
              size="md"
              disabled={busy}
              onClick={() => login({ loginMethods: ['wallet'] })}
            >
              Continue with a wallet
            </Button>
          </div>

          {oauthError ? (
            <p role="alert" className="text-[13px] text-[var(--ot-block-text)]">
              {oauthError}
            </p>
          ) : null}
        </>
      )}

      <p className="text-[12px] text-[var(--ot-text-3)]">
        Ottopus never holds a key and never asks for a seed phrase.
      </p>
    </div>
  )
}
