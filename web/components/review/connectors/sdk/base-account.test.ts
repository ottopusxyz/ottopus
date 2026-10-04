import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  BASE_ID,
  baseAccountConnector,
  openBaseAccount,
  resetBaseAccount,
  restoreBaseAccount,
  type BaseProvider,
} from './base-account'

const ACCOUNT = '0x1111111111111111111111111111111111111111'

function fake(accounts: string[]) {
  const request = vi.fn(async ({ method }: { method: string }) => {
    if (method === 'eth_requestAccounts') return [ACCOUNT]
    if (method === 'eth_accounts') return accounts
    if (method === 'eth_chainId') return '0x38'
    throw new Error(`unexpected ${method}`)
  })
  return { request, disconnect: vi.fn(async () => {}) } as unknown as BaseProvider & { request: typeof request }
}

beforeEach(() => resetBaseAccount())

describe('openBaseAccount', () => {
  it('starts the provider on the plan chain and asks for an account', async () => {
    const provider = fake([])
    const init = vi.fn(async () => provider)
    const opened = await openBaseAccount({ chain: 'eip155:56', init })
    expect(init).toHaveBeenCalledWith({ evmId: 56 })
    expect(opened.held).toEqual({ accounts: [ACCOUNT], chainId: 'eip155:56' })
    expect(provider.request).toHaveBeenCalledWith({ method: 'eth_requestAccounts' })
  })

  it('keeps one provider per page', async () => {
    const init = vi.fn(async () => fake([]))
    await openBaseAccount({ chain: 'eip155:56', init })
    await openBaseAccount({ chain: 'eip155:56', init })
    expect(init).toHaveBeenCalledTimes(1)
  })

  it('starts again after a failed start', async () => {
    const init = vi.fn<() => Promise<BaseProvider>>().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(fake([]))
    await expect(openBaseAccount({ chain: 'eip155:56', init })).rejects.toThrow('offline')
    await expect(openBaseAccount({ chain: 'eip155:56', init })).resolves.toBeTruthy()
  })

  it('refuses a chain no wallet can connect on', async () => {
    await expect(openBaseAccount({ chain: 'solana:mainnet', init: async () => fake([]) })).rejects.toThrow()
  })
})

describe('restoreBaseAccount', () => {
  it('reads the account back without prompting', async () => {
    const provider = fake([ACCOUNT])
    const restored = await restoreBaseAccount({ chain: 'eip155:56', init: async () => provider })
    expect(restored?.held.accounts).toEqual([ACCOUNT])
    expect(provider.request).not.toHaveBeenCalledWith({ method: 'eth_requestAccounts' })
  })

  it('is null when nothing was left behind', async () => {
    expect(await restoreBaseAccount({ chain: 'eip155:56', init: async () => fake([]) })).toBeNull()
  })
})

describe('the connector', () => {
  it('carries the picked face, restores under its own name, and disconnects on Base’s side', async () => {
    const provider = fake([ACCOUNT])
    const connector = baseAccountConnector(async () => provider)
    expect(connector).toMatchObject({ id: BASE_ID, kind: 'sdk' })
    const opened = await connector.connect({ chain: 'eip155:56', face: { name: 'Base (formerly Coinbase Wallet)', icon: 'https://x/logo.png' } })
    expect(opened.wallet).toMatchObject({ name: 'Base (formerly Coinbase Wallet)', icon: 'https://x/logo.png', connector })
    expect((await connector.restore({ chain: 'eip155:56' }))?.wallet.name).toBe('Base')
    await connector.disconnect(opened.wallet)
    expect(provider.disconnect).toHaveBeenCalled()
  })
})
