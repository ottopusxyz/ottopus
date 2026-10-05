import { describe, expect, it } from 'vitest'
import { connectorFor, installedConnector, walletConnect, type InjectedWallet } from './index'
import { BASE_ID } from './sdk/base-account'
import { WC_ID } from './walletconnect'

const A = '0x1111111111111111111111111111111111111111'

function installed(answers: Record<string, unknown>) {
  const asked: string[] = []
  const wallet: InjectedWallet = {
    rdns: 'io.metamask',
    name: 'MetaMask',
    icon: null,
    provider: {
      request: async ({ method }) => {
        asked.push(method)
        if (!(method in answers)) throw new Error(`unexpected ${method}`)
        return answers[method]
      },
    },
  }
  return { wallet, asked }
}

describe('installedConnector', () => {
  it('asks the wallet’s own provider and keeps one connector per wallet', async () => {
    const { wallet, asked } = installed({ eth_requestAccounts: [A], eth_chainId: '0x38' })
    const connector = installedConnector(wallet)
    expect(installedConnector(wallet)).toBe(connector)
    expect(connector).toMatchObject({ id: 'io.metamask', kind: 'installed' })
    const found = await connector.connect({ chain: 'eip155:56' })
    expect(found.held).toEqual({ accounts: [A], chainId: 'eip155:56' })
    expect(found.wallet).toMatchObject({ name: 'MetaMask', connector, provider: wallet.provider })
    expect(asked).toEqual(['eth_requestAccounts', 'eth_chainId'])
  })

  it('restores without prompting, and holds nothing from a wallet that shares no account', async () => {
    const { wallet, asked } = installed({ eth_accounts: [], eth_chainId: '0x38' })
    expect(await installedConnector(wallet).restore({ chain: 'eip155:56' })).toBeNull()
    expect(asked).not.toContain('eth_requestAccounts')
  })

  it('asks the wallet to revoke on disconnect, and shrugs when it cannot', async () => {
    const { wallet, asked } = installed({})
    const connector = installedConnector(wallet)
    await connector.disconnect({ connector, name: wallet.name, icon: null, provider: wallet.provider })
    expect(asked).toEqual(['wallet_revokePermissions'])
  })
})

describe('connectorFor', () => {
  const { wallet } = installed({})

  it('finds each kind by the id it is remembered under', () => {
    expect(connectorFor('io.metamask', [wallet], null)).toBe(installedConnector(wallet))
    expect(connectorFor(WC_ID, [], 'p')).toBe(walletConnect('p'))
    expect(connectorFor(BASE_ID, [], null)?.kind).toBe('sdk')
  })

  it('is null for what is not available here', () => {
    expect(connectorFor(null, [wallet], 'p')).toBeNull()
    expect(connectorFor('io.rabby', [wallet], 'p')).toBeNull()
    expect(connectorFor(WC_ID, [wallet], null)).toBeNull()
  })
})
