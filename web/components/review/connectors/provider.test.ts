import { describe, expect, it } from 'vitest'
import { caip2OfHex, describeConnectError, needsSwitch, readConnection, requestConnection, rereadHeld, revokeConnection, switchTo } from './provider'

type Answer = unknown | (() => unknown)

function fake(answers: Record<string, Answer[]>) {
  const asked: { method: string; params?: unknown[] }[] = []
  return {
    asked,
    request: async (args: { method: string; params?: unknown[] }) => {
      asked.push(args)
      const next = answers[args.method]?.shift()
      if (next === undefined) throw new Error(`unexpected ${args.method}`)
      return typeof next === 'function' ? (next as () => unknown)() : next
    },
  }
}

const A = '0x1111111111111111111111111111111111111111'
const B = '0x2222222222222222222222222222222222222222'
const refuse = (code: number, message = 'no') => () => {
  throw Object.assign(new Error(message), { code })
}

describe('connections', () => {
  it('reads accounts and chain as CAIP-2', async () => {
    const provider = fake({ eth_requestAccounts: [[A, B]], eth_chainId: ['0x38'] })
    expect(await requestConnection(provider)).toEqual({ accounts: [A, B], chainId: 'eip155:56' })
    expect(caip2OfHex('0x2105')).toBe('eip155:8453')
  })

  it('restores without prompting, and holds nothing when the wallet allows nothing', async () => {
    const provider = fake({ eth_accounts: [[], [A]], eth_chainId: ['0x1', '0x1'] })
    expect(await readConnection(provider)).toBeNull()
    expect(await readConnection(provider)).toEqual({ accounts: [A], chainId: 'eip155:1' })
    expect(provider.asked.some((a) => a.method === 'eth_requestAccounts')).toBe(false)
  })
})

describe('needsSwitch', () => {
  it('only for the plan’s account on another chain', () => {
    expect(needsSwitch({ accounts: [A], chainId: 'eip155:1' }, A.toUpperCase().replace('0X', '0x'), 'eip155:56')).toBe(true)
    expect(needsSwitch({ accounts: [A], chainId: 'eip155:56' }, A, 'eip155:56')).toBe(false)
  })

  it('never for a different account', () => {
    expect(needsSwitch({ accounts: [B], chainId: 'eip155:1' }, A, 'eip155:56')).toBe(false)
    expect(needsSwitch({ accounts: [], chainId: 'eip155:1' }, A, 'eip155:56')).toBe(false)
  })
})

describe('switchTo', () => {
  it('asks the wallet for the chain in hex', async () => {
    const provider = fake({ wallet_switchEthereumChain: [null] })
    await switchTo(provider, 'eip155:56')
    expect(provider.asked).toEqual([{ method: 'wallet_switchEthereumChain', params: [{ chainId: '0x38' }] }])
  })

  it('teaches the wallet an unknown chain, then asks again', async () => {
    const provider = fake({ wallet_switchEthereumChain: [refuse(4902), null], wallet_addEthereumChain: [null] })
    await switchTo(provider, 'eip155:56')
    expect(provider.asked.map((a) => a.method)).toEqual([
      'wallet_switchEthereumChain',
      'wallet_addEthereumChain',
      'wallet_switchEthereumChain',
    ])
    expect((provider.asked[1]!.params![0] as { chainId: string }).chainId).toBe('0x38')
  })

  it('passes a refusal through without adding anything', async () => {
    const provider = fake({ wallet_switchEthereumChain: [refuse(4001, 'User rejected')] })
    await expect(switchTo(provider, 'eip155:56')).rejects.toMatchObject({ code: 4001 })
    expect(provider.asked).toHaveLength(1)
  })

  it('refuses a chain that is not EVM before the wallet is asked', async () => {
    const provider = fake({})
    await expect(switchTo(provider, 'solana:mainnet')).rejects.toThrow()
    expect(provider.asked).toEqual([])
  })
})

describe('describeConnectError', () => {
  it('says a declined request was declined, in the wallet named', () => {
    expect(describeConnectError({ code: 4001, message: 'User rejected the request.' }, 'MetaMask')).toBe(
      'The request was declined in MetaMask.',
    )
  })

  it('points at the request the wallet already has open', () => {
    expect(describeConnectError({ code: -32002, message: 'Already processing eth_requestAccounts.' }, 'Rabby')).toBe(
      'Rabby already has a request open. Open Rabby and answer it there.',
    )
  })

  it("passes on the wallet's own message, and says something when there is none", () => {
    expect(describeConnectError(new Error('Wallet is locked'), 'MetaMask')).toBe('Wallet is locked')
    expect(describeConnectError(null, 'MetaMask')).toBe('MetaMask did not answer.')
  })
})

describe('disconnecting', () => {
  it('asks the wallet to revoke the accounts permission', async () => {
    const provider = fake({ wallet_revokePermissions: [null] })
    await revokeConnection(provider)
    expect(provider.asked).toEqual([{ method: 'wallet_revokePermissions', params: [{ eth_accounts: {} }] }])
  })

  it('does not throw when the wallet has no such method', async () => {
    const provider = fake({ wallet_revokePermissions: [refuse(-32601, 'method not found')] })
    await expect(revokeConnection(provider)).resolves.toBeUndefined()
  })
})

describe('rereadHeld', () => {
  const walletOn = (chain: string, gate?: Promise<void>) => ({
    provider: {
      request: async ({ method }: { method: string }) => {
        await gate
        return method === 'eth_accounts' ? [A] : chain
      },
    },
  })

  it('reads the wallet held now, not one a caller remembered', async () => {
    const now = walletOn('0x38')
    expect(await rereadHeld(() => now)).toEqual({ wallet: now, held: { accounts: [A], chainId: 'eip155:56' } })
    expect(await rereadHeld(() => null)).toBeNull()
  })

  it('drops the answer of a wallet that was replaced while it answered', async () => {
    let release = () => {}
    const slow = walletOn('0x1', new Promise<void>((r) => (release = r)))
    let current: { provider: unknown } = slow
    const reading = rereadHeld(() => current as typeof slow)
    current = walletOn('0x38')
    release()
    expect(await reading).toBeNull()
  })
})
