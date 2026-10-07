import { describe, expect, it } from 'vitest'
import { AGENT_PROVIDERS, agentProvider, capabilitiesOf, profileOf } from './index.js'

const arm = (over: Partial<Parameters<typeof capabilitiesOf>[0]> = {}) => ({
  walletType: 'agentic',
  agentProvider: 'binance',
  isWatchOnly: false,
  autoExecute: false,
  provedAt: '2026-10-01T00:00:00Z',
  ...over,
})

describe('provider profiles', () => {
  it('finds Binance, and says how its CLI signs and executes', () => {
    expect(agentProvider('binance')).toMatchObject({
      name: 'Binance Agentic Wallet',
      cli: 'baw',
      chains: ['eip155:56', 'eip155:1', 'eip155:8453'],
      sign: {
        command: 'sign-message preview/execute',
        typedData: true,
        handBack: 'its signature followed by its signatureRecovery',
      },
      execute: { command: 'contract-call preview/execute', requiresDevMode: true },
    })
  })

  /** Nothing outside a profile knows a vendor's CLI, so a profile that says nothing leaves the agent with nothing. */
  it('has every profile spell out its own signing, with the challenge in the commands', () => {
    const request = { address: '0x00000000000000000000000000000000000000aa', typedData: { primaryType: 'LinkAgentWallet' } }
    for (const profile of Object.values(AGENT_PROVIDERS)) {
      const steps = profile.signSteps(request).join('\n')
      expect(steps).toContain(profile.cli)
      expect(steps).toContain(request.address)
      expect(steps).toContain('LinkAgentWallet')
      expect(profile.sign.handBack).not.toBe('')
    }
  })

  /** The calls an agent sends are the ones that were approved, so the commands carry them whole and in order. */
  it('has every profile spell out an execution: one command per call, in order, with nothing left to fill in', () => {
    const request = {
      address: '0x00000000000000000000000000000000000000aa',
      calls: [
        { to: '0x55d398326f99059ff775485246999027b3197955', value: '0', data: '0x095ea7b3', chainReference: '56' },
        { to: '0x1111111254eeb25477b68fb85ed929f73a960582', value: '25', data: '0x', chainReference: '56' },
      ],
    }
    for (const profile of Object.values(AGENT_PROVIDERS)) {
      const steps = profile.executeSteps(request)
      const words = steps.join('\n')
      expect(words).toContain(profile.cli)
      const first = steps.findIndex((line) => line.includes(request.calls[0]!.to))
      const second = steps.findIndex((line) => line.includes(request.calls[1]!.to))
      expect(first).toBeGreaterThan(-1)
      expect(second).toBeGreaterThan(first)
      expect(steps[first]).toContain(request.address)
      expect(steps[first]).toContain(request.calls[0]!.data)
      expect(steps[second]).toContain(request.calls[1]!.value)
    }
  })

  it('writes the Binance commands as baw takes them, leaving off a value or input data a call does not have', () => {
    const steps = agentProvider('binance')!.executeSteps({
      address: '0x00000000000000000000000000000000000000aa',
      calls: [
        { to: '0x55d398326f99059ff775485246999027b3197955', value: '0', data: '0x095ea7b3', chainReference: '56' },
        { to: '0x1111111254eeb25477b68fb85ed929f73a960582', value: '25', data: '0x', chainReference: '56' },
      ],
    })
    expect(steps).toContain(
      'Call 1 of 2: baw contract-call preview --binanceChainId 56 --from 0x00000000000000000000000000000000000000aa ' +
        '--to 0x55d398326f99059ff775485246999027b3197955 --inputData 0x095ea7b3 --json',
    )
    expect(steps).toContain(
      'Call 2 of 2: baw contract-call preview --binanceChainId 56 --from 0x00000000000000000000000000000000000000aa ' +
        '--to 0x1111111254eeb25477b68fb85ed929f73a960582 --value 25 --json',
    )
    const words = steps.join('\n')
    expect(words).toContain('baw contract-call execute --requestId <requestId> --json')
    expect(words).toContain('do not start a call until the one before it has confirmed')
    expect(words).toContain('Developer Mode')
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
