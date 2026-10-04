import { describe, expect, it } from 'vitest'
import { createInjectedStore, installedFor, type InjectedWallet } from './installed'

const provider = { request: async () => null }

function announce(target: EventTarget, info: Record<string, unknown>, p: unknown = provider) {
  const event = new Event('eip6963:announceProvider') as Event & { detail?: unknown }
  event.detail = { info, provider: p }
  target.dispatchEvent(event)
}

describe('createInjectedStore', () => {
  it('asks once on the first subscriber and collects what answers', () => {
    const target = new EventTarget()
    let asked = 0
    target.addEventListener('eip6963:requestProvider', () => {
      asked += 1
      announce(target, { rdns: 'io.metamask', name: 'MetaMask', icon: 'data:image/svg+xml;base64,AA' })
    })
    const store = createInjectedStore(target)
    expect(store.get()).toEqual([])
    let told = 0
    store.subscribe(() => (told += 1))
    store.subscribe(() => {})
    expect(asked).toBe(1)
    expect(store.get().map((w) => w.rdns)).toEqual(['io.metamask'])
    announce(target, { rdns: 'io.rabby', name: 'Rabby' })
    expect(told).toBe(2)
    expect(store.get().map((w) => w.name)).toEqual(['MetaMask', 'Rabby'])
  })

  it('keeps one entry for a wallet that announces twice, and the same list', () => {
    const target = new EventTarget()
    const store = createInjectedStore(target)
    store.subscribe(() => {})
    announce(target, { rdns: 'io.metamask', name: 'MetaMask' })
    const first = store.get()
    announce(target, { rdns: 'io.metamask', name: 'MetaMask' })
    expect(store.get()).toBe(first)
    expect(first).toHaveLength(1)
  })

  it('drops an announcement with no rdns, no name or no provider', () => {
    const target = new EventTarget()
    const store = createInjectedStore(target)
    store.subscribe(() => {})
    announce(target, { name: 'Nameless' })
    announce(target, { rdns: 'x.y' })
    announce(target, { rdns: 'x.y', name: 'No provider' }, {})
    expect(store.get()).toEqual([])
  })

  it('renders only an inline icon', () => {
    const target = new EventTarget()
    const store = createInjectedStore(target)
    store.subscribe(() => {})
    announce(target, { rdns: 'a.b', name: 'Remote', icon: 'https://example.com/track.png' })
    announce(target, { rdns: 'c.d', name: 'Script', icon: 'javascript:alert(1)' })
    expect(store.get().map((w) => w.icon)).toEqual([null, null])
  })
})

describe('installedFor', () => {
  const wallet = (rdns: string): InjectedWallet => ({ rdns, name: rdns, icon: null, provider })
  const installed = [wallet('io.rabby'), wallet('io.metamask'), wallet('com.binance.wallet')]

  it('finds the installed wallet the account was linked with', () => {
    expect(installedFor('metamask', installed)?.rdns).toBe('io.metamask')
    expect(installedFor('rabby_wallet', installed)?.rdns).toBe('io.rabby')
    expect(installedFor('binance_wallet', installed)?.rdns).toBe('com.binance.wallet')
  })

  it('has nothing for a wallet that is not installed', () => {
    expect(installedFor('phantom', installed)).toBeNull()
  })

  it('has nothing for a kind with no extension, or none at all', () => {
    for (const kind of ['safe', 'ledger', 'wallet_connect', 'watch_only', 'agentic', 'unknown', 'toString', undefined]) {
      expect(installedFor(kind, installed)).toBeNull()
    }
  })
})
