'use client'

import { useLoginWithEmail, useLoginWithOAuth, usePrivy } from '@privy-io/react-auth'
import { useState, type ReactNode, type FormEvent } from 'react'
import { Gaze, OttoBadge } from '@/components/brand'
import { Button, Callout, CodeInput, Input } from '@/components/ui'
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

/** Privy's errors are developer-facing. These are the ones a person reads. */
function readable(error: Error | null | undefined, fallback: string): string {
  const raw = error?.message ?? ''
  if (/invalid|incorrect/i.test(raw)) return 'That code did not match. Check it and try again.'
  if (/expired/i.test(raw)) return 'That code has expired. Send a new one.'
  if (/too many|rate/i.test(raw)) return 'Too many attempts. Wait a moment, then send a new code.'
  if (/not enabled|disabled|disallowed|not allowed|not configured|unsupported/i.test(raw)) {
    return 'That sign-in method is not enabled for this app yet.'
  }
  return fallback
}

export interface SignInPanelProps {
  /** The page uses h1; the dialog uses h2 under its own labelling. */
  headingAs?: 'h1' | 'h2'
  headingId?: string
  title?: string
  className?: string
  /** Slot for the badge, so a page can hand in a livelier one. */
  mascot?: ReactNode
  /**
   * Called, and awaited, before handing over to a UI we do not own.
   *
   * Privy's modal is an ordinary element with a high z-index. A native
   * `<dialog>` opened with `showModal()` sits in the top layer, which nothing
   * in normal stacking can climb above — so inside our dialog, Privy's renders
   * behind it and cannot be clicked. The container uses this to get out of the
   * way first.
   */
  onLeave?: () => Promise<void> | void
}

/**
 * The sign-in surface, and the whole of it — the dialog and /signin render this
 * same component so the two cannot drift into saying different things about
 * what signing in means.
 *
 * Laid out as D1 in the app design: badge, title, one line, then the ways in as
 * a stacked list. Email and Google are ours, on Privy's headless hooks, because
 * they are the part a person reads. "Connect a wallet" opens Privy's own modal,
 * where the wallet list is theirs and we style only the frame around it.
 */
export function SignInPanel(props: SignInPanelProps) {
  // The hooks below need Privy's context, and calling them without it throws.
  // Splitting on availability here is what keeps that impossible.
  return usePrivyAvailable() ? <LiveSignIn {...props} /> : <UnconfiguredSignIn {...props} />
}

function Header({
  headingAs: Heading = 'h2',
  headingId,
  title = 'Sign in to Ottopus',
  mascot,
  subtitle,
}: SignInPanelProps & { subtitle?: string }) {
  return (
    <div className="flex flex-col items-center gap-[5px] text-center">
      {mascot ?? (
        <Gaze>
          <OttoBadge tier="icon" size={44} animate="idle" />
        </Gaze>
      )}
      <Heading id={headingId} className="font-display text-[19px] font-bold">
        {title}
      </Heading>
      {subtitle ? (
        <span className="text-[13px] leading-[1.45] text-[var(--ot-text-2)]">{subtitle}</span>
      ) : null}
    </div>
  )
}

function UnconfiguredSignIn(props: SignInPanelProps) {
  return (
    <div className={cn('flex flex-col gap-4', props.className)}>
      <Header {...props} />
      <Callout severity="caution" title="Sign-in is not available">
        Privy is not configured for this deployment, so there is nothing to sign in to yet.
      </Callout>
    </div>
  )
}

/** The list of ways in, the email address, or the code. One at a time. */
type Step = 'choose' | 'email' | 'code'

function LiveSignIn(props: SignInPanelProps) {
  const { className, onLeave } = props
  const { login } = usePrivy()
  const { sendCode, loginWithCode, state: emailState } = useLoginWithEmail()
  const { initOAuth, state: oauthState } = useLoginWithOAuth()

  const [step, setStep] = useState<Step>('choose')
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [oauthFailure, setOauthFailure] = useState<Error | null>(null)

  const sending = emailState.status === 'sending-code'
  const submitting = emailState.status === 'submitting-code'
  const oauthBusy = oauthState.status === 'loading'
  const busy = sending || submitting || oauthBusy

  const oauthError = oauthState.status === 'error' ? oauthState.error : oauthFailure
  const failure =
    emailState.status === 'error'
      ? readable(emailState.error, 'That did not work. Try again.')
      : oauthError
        ? readable(oauthError, 'Google sign-in did not start. It may not be enabled for this app.')
        : null

  const onSendCode = async (e: FormEvent) => {
    e.preventDefault()
    try {
      await sendCode({ email })
      setStep('code')
    } catch {
      // The hook's own state carries the message. Staying on this step keeps
      // the address on screen so it can be corrected rather than retyped.
    }
  }

  const onVerify = async (e: FormEvent) => {
    e.preventDefault()
    await loginWithCode({ code }).catch(() => {})
  }

  const onGoogle = async () => {
    setOauthFailure(null)
    try {
      await initOAuth({ provider: 'google' })
    } catch (err) {
      // Swallowing this is how a dead button stays dead and silent. Google
      // switched off in the Privy dashboard lands here.
      setOauthFailure(err as Error)
    }
  }

  return (
    <div className={cn('flex flex-col gap-4', className)}>
      <Header
        {...props}
        subtitle={
          step === 'code'
            ? `We sent a code to ${email}.`
            : 'Any method you link once can sign you in later.'
        }
      />

      {step === 'choose' ? (
        <div className="flex flex-col gap-2">
          <Button variant="secondary" shape="block" disabled={busy} onClick={onGoogle}>
            <GoogleMark />
            {oauthBusy ? 'Taking you to Google…' : 'Continue with Google'}
          </Button>
          <Button variant="secondary" shape="block" disabled={busy} onClick={() => setStep('email')}>
            Continue with email
          </Button>
          <div className="flex items-center gap-[10px] py-[2px]" aria-hidden>
            <span className="h-px flex-1 bg-[var(--ot-border)]" />
            <span className="text-[12px] text-[var(--ot-text-3)]">or</span>
            <span className="h-px flex-1 bg-[var(--ot-border)]" />
          </div>
          <Button
            variant="secondary"
            shape="block"
            disabled={busy}
            onClick={async () => {
              await onLeave?.()
              login({ loginMethods: ['wallet'] })
            }}
          >
            Connect a wallet
          </Button>
        </div>
      ) : null}

      {step === 'email' ? (
        <form onSubmit={onSendCode} className="flex flex-col gap-2">
          <Input
            type="email"
            name="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            autoComplete="email"
            aria-label="Email address"
            autoFocus
            required
            invalid={Boolean(failure)}
          />
          <Button type="submit" variant="primary" size="lg" fullWidth disabled={sending || !email}>
            {sending ? 'Sending a code…' : 'Send me a code'}
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => setStep('choose')}>
            Back
          </Button>
        </form>
      ) : null}

      {step === 'code' ? (
        <form onSubmit={onVerify} className="flex flex-col gap-3">
          <CodeInput
            name="code"
            value={code}
            onChange={setCode}
            autoFocus
            invalid={Boolean(failure)}
          />
          <Button
            type="submit"
            variant="primary"
            size="lg"
            fullWidth
            disabled={submitting || code.length < 6}
          >
            {submitting ? 'Checking…' : 'Continue'}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              setCode('')
              setStep('email')
            }}
          >
            Use a different email
          </Button>
        </form>
      ) : null}

      {failure ? (
        <p role="alert" className="text-center text-[13px] text-[var(--ot-block-text)]">
          {failure}
        </p>
      ) : null}

      <p className="text-center text-[11.5px] leading-[1.5] text-[var(--ot-text-3)]">
        Ottopus never holds a key and never asks for a seed phrase.
      </p>
    </div>
  )
}
