import { describe, expect, it } from 'vitest'
import { appLinkFor, isPhone, walletLinks } from './links'

const PAGE = 'https://ottopus.xyz/review/abc?x=1'

describe('walletLinks', () => {
  it('builds each wallet’s published open-this-page link', () => {
    const byType = Object.fromEntries(walletLinks(PAGE).map((l) => [l.type, l.href]))
    expect(byType.metamask).toBe('https://link.metamask.io/dapp/ottopus.xyz/review/abc?x=1')
    expect(byType.trust).toBe(`https://link.trustwallet.com/open_url?coin_id=60&url=${encodeURIComponent(PAGE)}`)
    expect(byType.coinbase_wallet).toBe(`https://go.cb-w.com/dapp?cb_url=${encodeURIComponent(PAGE)}`)
    expect(Object.keys(byType)).toEqual(['metamask', 'trust', 'coinbase_wallet'])
  })

  it('leads with the wallet the account was linked with', () => {
    expect(walletLinks(PAGE, 'trust')[0]!.type).toBe('trust')
    expect(walletLinks(PAGE, 'safe')[0]!.type).toBe('metamask')
    expect(walletLinks(PAGE, 'trust')).toHaveLength(walletLinks(PAGE).length)
  })
})

describe('appLinkFor', () => {
  it('finds a wallet’s link by the rdns a registry row carries', () => {
    expect(appLinkFor('com.coinbase.wallet', PAGE)).toBe(`https://go.cb-w.com/dapp?cb_url=${encodeURIComponent(PAGE)}`)
    expect(appLinkFor('xyz.unknown', PAGE)).toBeNull()
    expect(appLinkFor(null, PAGE)).toBeNull()
  })
})

describe('isPhone', () => {
  it('tells a phone from a desktop', () => {
    expect(isPhone('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)')).toBe(true)
    expect(isPhone('Mozilla/5.0 (Linux; Android 15; Pixel 9)')).toBe(true)
    expect(isPhone('Mozilla/5.0 (X11; Linux x86_64) Chrome/140')).toBe(false)
  })
})
