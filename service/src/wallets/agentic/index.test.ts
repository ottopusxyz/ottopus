import { describe, expect, it } from 'vitest'
import { AGENT_PROVIDERS, agentProvider, capabilitiesOf, profileOf } from './index.js'

const arm = (over: Partial<Parameters<typeof capabilitiesOf>[0]> = {}) => ({
  walletType: 'agentic',
  agentProvider: 'binance',
  isWatchOnly: false,
  provedAt: '2026-10-01T00:00:00Z',
  ...over,
})

describe('provider profiles', () => {
  it('finds Binance, and says how its CLI signs and executes', () => {
    expect(agentProvider('binance')).toMatchObject({
      name: 'Binance Agentic Wallet',
      cli: 'baw',
      chains: ['eip155:56', 'eip155:1', 'eip155:8453'],
      sign: { command: 'sign-message preview/execute', typedData: true },
      execute: { command: 'contract-call preview/execute', requiresDevMode: true },
    })
  })

  it('is keyed by the id each profile carries', () => {
    for (const [id, profile] of Object.entries(AGENT_PROVIDERS)) expect(profile.id).toBe(id)
  })

  it.each(['abacus', '', 'constructor', 'toString', null, undefined])('has no provider called %s', (id) => {
    expect(agentProvider(id)).toBeNull()
  })

  it('answers only for an agentic arm', () => {
    expect(profileOf({ walletType: 'agentic', agentProvider: 'binance' })?.id).toBe('binance')
    expect(profileOf({ walletType: 'metamask', agentProvider: null })).toBeNull()
    expect(profileOf({ walletType: 'binance_wallet', agentProvider: null })).toBeNull()
  })
})

describe('what an arm can do', () => {
  it('lets an agentic arm execute, with no browser signer', () => {
    expect(capabilitiesOf(arm())).toEqual({ canSign: true, browserSigner: false, agentExecutes: true })
  })

  it('lets a proved connected wallet sign in the browser and nothing else', () => {
    expect(capabilitiesOf(arm({ walletType: 'metamask', agentProvider: null }))).toEqual({
      canSign: true,
      browserSigner: true,
      agentExecutes: false,
    })
  })

  it('gives a watch-only or unproved arm nothing', () => {
    const none = { canSign: false, browserSigner: false, agentExecutes: false }
    expect(capabilitiesOf(arm({ walletType: 'watch_only', agentProvider: null, isWatchOnly: true, provedAt: null }))).toEqual(none)
    expect(capabilitiesOf(arm({ provedAt: null }))).toEqual(none)
  })

  /** A row left behind by a provider that was removed: no browser, no profile, so no way to act. */
  it('gives an agentic arm with an unknown provider nothing', () => {
    expect(capabilitiesOf(arm({ agentProvider: 'gone' })).canSign).toBe(false)
  })
})
