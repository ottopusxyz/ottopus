import { describe, expect, it } from 'vitest'
import type { DirectoryWallet } from './directory'
import { routeFor, routeForSdk, sdkWalletsHere } from './route'
import { baseAccount } from './sdk/base-account'

const PAGE = 'https://ottopus.xyz/review/abc'
const row = (over: Partial<DirectoryWallet>): DirectoryWallet => ({
  id: 'x',
  name: 'X',
  icon: null,
  rdns: null,
  native: null,
  universal: null,
  ...over,
})
const desktop = { onPhone: false, pageUrl: PAGE }
const phone = { onPhone: true, pageUrl: PAGE }

describe('routeFor', () => {
  it('pairs when no wallet was named', () => {
    expect(routeFor(null, desktop)).toEqual({ via: 'walletconnect' })
    expect(routeFor(null, phone)).toEqual({ via: 'walletconnect' })
  })

  it('pairs a wallet the registry gives a link for', () => {
    expect(routeFor(row({ universal: 'https://metamask.app.link', rdns: 'io.metamask' }), phone)).toEqual({ via: 'walletconnect' })
    expect(routeFor(row({ universal: 'https://metamask.app.link', rdns: 'io.metamask' }), desktop)).toEqual({ via: 'walletconnect' })
  })

  it('keeps an SDK wallet on its own route even when the registry lists a pairing link', () => {
    const listed = row({ universal: 'https://x.example', native: 'cbwallet://', rdns: 'com.coinbase.wallet' })
    expect(routeFor(listed, desktop)).toEqual({ via: 'sdk', wallet: baseAccount })
    expect(routeFor(listed, phone)).toMatchObject({ via: 'app-link' })
  })

  it('sends a wallet with no pairing link to its app on a phone', () => {
    expect(routeFor(row({ rdns: 'com.coinbase.wallet' }), phone)).toEqual({
      via: 'app-link',
      href: `https://go.cb-w.com/dapp?cb_url=${encodeURIComponent(PAGE)}`,
    })
  })

  it('opens that wallet’s own SDK on a desktop', () => {
    expect(routeFor(row({ rdns: 'com.coinbase.wallet' }), desktop)).toEqual({ via: 'sdk', wallet: baseAccount })
  })

  it('routes an SDK wallet from its registration alone', () => {
    expect(routeForSdk(baseAccount, desktop)).toEqual({ via: 'sdk', wallet: baseAccount })
    expect(routeForSdk(baseAccount, phone)).toEqual({
      via: 'app-link',
      href: `https://go.cb-w.com/dapp?cb_url=${encodeURIComponent(PAGE)}`,
    })
    // Asked for its app with no published link, it still has its window.
    const unlinked = { ...baseAccount, rdns: ['xyz.unknown'] }
    expect(routeForSdk(unlinked, phone)).toEqual({ via: 'sdk', wallet: unlinked })
  })

  it('gives an SDK wallet its own row only where its window opens', () => {
    expect(sdkWalletsHere(desktop)).toContain(baseAccount)
    expect(sdkWalletsHere(phone)).not.toContain(baseAccount)
  })

  it('still draws a code for a wallet with no link and no SDK', () => {
    expect(routeFor(row({ rdns: 'xyz.unknown' }), desktop)).toEqual({ via: 'walletconnect' })
    expect(routeFor(row({}), phone)).toEqual({ via: 'walletconnect' })
  })
})
