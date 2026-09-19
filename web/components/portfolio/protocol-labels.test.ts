import { describe, expect, it } from 'vitest'
import { groupKind, heldTag, moduleLabel } from './protocol-labels'

describe('how a protocol row says it is held', () => {
  it('calls a loan debt, whatever module it is in', () => {
    expect(heldTag('loan', 'lending')).toEqual({ label: 'Debt', tone: 'block' })
    expect(heldTag('loan', 'leveraged_farming').label).toBe('Debt')
  })

  it('has a word for every way of holding', () => {
    expect(heldTag('deposit', 'lending').label).toBe('Deposited')
    expect(heldTag('staked', 'staked').label).toBe('Staked')
    expect(heldTag('locked', 'locked').label).toBe('Locked')
    expect(heldTag('reward', 'rewards')).toEqual({ label: 'Reward', tone: 'ok' })
    expect(heldTag('investment', 'investment').label).toBe('Investment')
  })

  it('calls a vesting position vesting, unless it is the claimable part', () => {
    expect(heldTag('locked', 'vesting').label).toBe('Vesting')
    expect(heldTag('deposit', 'vesting').label).toBe('Vesting')
    expect(heldTag('reward', 'vesting').label).toBe('Reward')
  })

  it('never invents a module label', () => {
    expect(moduleLabel(null)).toBeNull()
    expect(moduleLabel('liquidity_pool')).toBe('Liquidity pool')
  })
})

describe('what a group header adds', () => {
  it('drops the module when the name already says it', () => {
    expect(groupKind({ name: 'Fluid Lending (#9468)', module: 'lending' })).toBeNull()
    expect(groupKind({ name: 'Merkl Rewards', module: 'rewards' })).toBeNull()
  })

  it('keeps it when the name does not', () => {
    expect(groupKind({ name: 'USDC/WETH', module: 'liquidity_pool' })).toBe('Liquidity pool')
    expect(groupKind({ name: 'Seamless WETH Vault', module: 'deposit' })).toBe('Deposit')
    expect(groupKind({ name: 'Anything', module: null })).toBeNull()
  })
})
