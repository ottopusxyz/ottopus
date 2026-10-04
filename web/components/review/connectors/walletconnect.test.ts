import { beforeEach, describe, expect, it } from 'vitest'
import {
  WC_ID,
  pairWalletConnect,
  resetWalletConnect,
  restoreWalletConnect,
  walletConnectConnector,
  type WcInit,
  type WcProvider,
} from './walletconnect'

const A = '0x1111111111111111111111111111111111111111'

interface Fake extends WcProvider {
  log: string[]
  proposed: unknown[]
  listeners: Map<string, Set<(...args: never[]) => void>>
}

/** A relay client that pairs on `connect` unless told to refuse. */
function fake(opts: { session?: boolean; refuse?: boolean; accounts?: string[]; approval?: Promise<void> } = {}): Fake {
  let accounts = opts.session ? (opts.accounts ?? [A]) : []
  const provider: Fake = {
    log: [],
    proposed: [],
    listeners: new Map(),
    session: opts.session ? { peer: { metadata: { name: 'Rainbow' } } } : undefined,
    on(event, listener) {
      if (!provider.listeners.has(event)) provider.listeners.set(event, new Set())
      provider.listeners.get(event)!.add(listener)
    },
    removeListener(event, listener) {
      provider.listeners.get(event)?.delete(listener)
    },
    async connect(proposal) {
      provider.log.push('connect')
      provider.proposed.push(proposal)
      for (const l of provider.listeners.get('display_uri') ?? []) (l as (uri: string) => void)('wc:abc@2')
      await opts.approval
      if (opts.refuse) throw Object.assign(new Error('rejected'), { code: 5000 })
      accounts = opts.accounts ?? [A]
      provider.session = { peer: { metadata: { name: 'Rainbow' } } }
    },
    async disconnect() {
      provider.log.push('disconnect')
      accounts = []
      provider.session = undefined
    },
    async request({ method }) {
      if (method === 'eth_accounts') return accounts
      if (method === 'eth_chainId') return '0x38'
      throw new Error(`unexpected ${method}`)
    },
  }
  return provider
}

const using = (provider: Fake, seen: unknown[] = []): WcInit => async (opts) => {
  seen.push(opts)
  return provider
}

beforeEach(() => resetWalletConnect())

describe('pairing', () => {
  it('hands over the code, proposes the plan’s chain, and holds what the wallet shared', async () => {
    const provider = fake()
    const seen: unknown[] = []
    const uris: string[] = []
    const paired = await pairWalletConnect({
      projectId: 'p',
      chain: 'eip155:56',
      init: using(provider, seen),
      onUri: (uri) => uris.push(uri),
    })
    expect(uris).toEqual(['wc:abc@2'])
    expect(paired.held).toEqual({ accounts: [A], chainId: 'eip155:56' })
    expect(seen).toMatchObject([{ projectId: 'p', evmId: 56 }])
    expect(provider.proposed).toMatchObject([{ optionalChains: [56] }])
    // The listener does not outlive the attempt.
    expect(provider.listeners.get('display_uri')?.size).toBe(0)
  })

  it('ends an earlier session before proposing a new one', async () => {
    const provider = fake({ session: true })
    await pairWalletConnect({ projectId: 'p', chain: 'eip155:56', init: using(provider), onUri: () => {} })
    expect(provider.log).toEqual(['disconnect', 'connect'])
  })

  it('throws the wallet’s refusal and leaves no listener behind', async () => {
    const provider = fake({ refuse: true })
    await expect(
      pairWalletConnect({ projectId: 'p', chain: 'eip155:56', init: using(provider), onUri: () => {} }),
    ).rejects.toThrow('rejected')
    expect(provider.listeners.get('display_uri')?.size).toBe(0)
  })

  it('does not call a session with no account a connection', async () => {
    const provider = fake({ accounts: [] })
    await expect(
      pairWalletConnect({ projectId: 'p', chain: 'eip155:56', init: using(provider), onUri: () => {} }),
    ).rejects.toThrow(/without sharing an account/)
  })

  it('starts one relay client however many times it is asked', async () => {
    const provider = fake()
    const seen: unknown[] = []
    const init = using(provider, seen)
    await pairWalletConnect({ projectId: 'p', chain: 'eip155:56', init, onUri: () => {} })
    await restoreWalletConnect({ projectId: 'p', chain: 'eip155:56', init })
    expect(seen).toHaveLength(1)
  })

  it('joins a pairing still open instead of proposing a second one', async () => {
    let approve = () => {}
    const provider = fake({ approval: new Promise<void>((r) => (approve = r)) })
    const connector = walletConnectConnector('p', using(provider))
    const first: string[] = []
    const second: string[] = []
    const rainbow = connector.connect({ chain: 'eip155:56', face: { name: 'Rainbow', icon: null }, onUri: (u) => first.push(u) })
    await Promise.resolve()
    await Promise.resolve()
    const trust = connector.connect({ chain: 'eip155:56', face: { name: 'Trust Wallet', icon: null }, onUri: (u) => second.push(u) })
    await new Promise((r) => setTimeout(r, 0))
    // One proposal, and the wallet picked second is shown the same code.
    expect(provider.log).toEqual(['connect'])
    expect(first).toEqual(['wc:abc@2'])
    expect(second).toEqual(['wc:abc@2'])
    approve()
    const [a, b] = await Promise.all([rainbow, trust])
    expect(a.held).toEqual(b.held)
    expect(a.wallet.provider).toBe(b.wallet.provider)
    expect(provider.log).toEqual(['connect'])
    expect(provider.listeners.get('display_uri')?.size).toBe(0)
  })

  it('proposes afresh once the last pairing has settled', async () => {
    const provider = fake({ refuse: true })
    const init = using(provider)
    await expect(pairWalletConnect({ projectId: 'p', chain: 'eip155:56', init, onUri: () => {} })).rejects.toThrow('rejected')
    await expect(pairWalletConnect({ projectId: 'p', chain: 'eip155:56', init, onUri: () => {} })).rejects.toThrow('rejected')
    expect(provider.log).toEqual(['connect', 'connect'])
  })

  it('refuses a chain no wallet can be on', async () => {
    await expect(
      pairWalletConnect({ projectId: 'p', chain: 'solana:mainnet', init: using(fake()), onUri: () => {} }),
    ).rejects.toThrow(/not a chain/)
  })
})

describe('restore', () => {
  it('reads a stored session back without proposing anything', async () => {
    const provider = fake({ session: true })
    const paired = await restoreWalletConnect({ projectId: 'p', chain: 'eip155:56', init: using(provider) })
    expect(paired?.held).toEqual({ accounts: [A], chainId: 'eip155:56' })
    expect(provider.log).toEqual([])
  })

  it('holds nothing when there is no session', async () => {
    const provider = fake()
    expect(await restoreWalletConnect({ projectId: 'p', chain: 'eip155:56', init: using(provider) })).toBeNull()
    expect(provider.log).toEqual([])
  })
})

describe('the connector', () => {
  it('names the paired wallet as picked, else as it named itself', async () => {
    const connector = walletConnectConnector('p', using(fake()))
    expect(connector).toMatchObject({ id: WC_ID, kind: 'walletconnect' })
    const uris: string[] = []
    const picked = await connector.connect({ chain: 'eip155:56', face: { name: 'Trust Wallet', icon: null }, onUri: (u) => uris.push(u) })
    expect(uris).toEqual(['wc:abc@2'])
    expect(picked.wallet).toMatchObject({ name: 'Trust Wallet', connector })
    expect(picked.held.accounts).toEqual([A])
    const restored = await connector.restore({ chain: 'eip155:56' })
    expect(restored?.wallet.name).toBe('Rainbow')
  })

  it('restores nothing without a session, and ends one on disconnect', async () => {
    const provider = fake()
    const connector = walletConnectConnector('p', using(provider))
    expect(await connector.restore({ chain: 'eip155:56' })).toBeNull()
    const { wallet } = await connector.connect({ chain: 'eip155:56' })
    await connector.disconnect(wallet)
    expect(provider.log).toEqual(['connect', 'disconnect'])
  })
})
