'use client'

import { PrivyProvider as Privy } from '@privy-io/react-auth'
import { Component, createContext, useContext, type ReactNode } from 'react'
import { SessionProvider } from './session-provider'

const APP_ID = (process.env.NEXT_PUBLIC_PRIVY_APP_ID ?? '').trim()

/**
 * Privy throws on an app id that is not exactly 25 characters, and it throws
 * during render — which on the server is a 500 for the whole page, error
 * boundary or not. Checking the length here is what keeps a mistyped
 * environment variable from taking down the landing page.
 *
 * A wrong-but-well-formed id still initialises and fails later, against Privy's
 * API rather than in our render. The boundary below is for that.
 */
const APP_ID_LENGTH = 25
const usable = APP_ID.length === APP_ID_LENGTH

/**
 * True only where Privy actually mounted.
 *
 * Not an env check: the env var can be present and wrong, and Privy throws on
 * an invalid app id at initialisation. Reading a context instead means every
 * consumer learns the same truth — including "the app id was rejected" — and
 * nothing calls a Privy hook outside a provider, which throws in its own right.
 */
const PrivyAvailable = createContext(false)

export function usePrivyAvailable(): boolean {
  return useContext(PrivyAvailable)
}

/**
 * Privy's initialisation error must not take the site down with it.
 *
 * The landing page, the styleguide and the review page have nothing to do with
 * signing in, and a typo in one environment variable should not blank them. On
 * failure this renders the same children with Privy marked unavailable, so the
 * sign-in surfaces explain themselves and everything else carries on.
 */
class PrivyBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch(error: Error) {
    console.error('[privy] provider failed to initialise; sign-in is disabled', error)
  }

  render() {
    if (this.state.failed) {
      return <PrivyAvailable.Provider value={false}>{this.props.children}</PrivyAvailable.Provider>
    }
    return this.props.children
  }
}

/**
 * Privy, configured for the one thing Ottopus asks of it: proving who you are.
 *
 * `loginMethods` is the allow-list for Privy's own modal, which this app opens
 * for the wallet step only — email and Google are our components on Privy's
 * headless hooks, so the design system holds through the part of the flow a
 * person actually reads.
 *
 * No embedded wallet is created. Ottopus never holds a key, and a wallet minted
 * on login would be a key Privy holds on the user's behalf inside our product —
 * close enough to the thing we promise not to do that it should not exist.
 * Wallets arrive through #7, with an ownership challenge.
 */
export function PrivyProvider({ children }: { children: ReactNode }) {
  if (!usable) {
    if (APP_ID) {
      console.error(
        `[privy] NEXT_PUBLIC_PRIVY_APP_ID must be ${APP_ID_LENGTH} characters; sign-in is disabled`,
      )
    }
    return <>{children}</>
  }

  return (
    <PrivyBoundary>
      <Privy
        appId={APP_ID}
        config={{
          loginMethods: ['email', 'google', 'wallet'],
          embeddedWallets: { ethereum: { createOnLogin: 'off' } },
          appearance: {
            // Only the wallet step shows Privy's own UI; this is what brands it.
            accentColor: '#F58A6A',
            logo: 'https://ottopus.xyz/icon.svg',
            landingHeader: 'Connect a wallet',
            loginMessage: 'Ottopus never asks for a seed phrase.',
          },
        }}
      >
        <PrivyAvailable.Provider value>
          <SessionProvider>{children}</SessionProvider>
        </PrivyAvailable.Provider>
      </Privy>
    </PrivyBoundary>
  )
}
