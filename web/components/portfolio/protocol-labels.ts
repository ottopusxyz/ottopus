import type { PositionGroup, ProtocolModule, ProtocolPositionType } from '@/lib/api'
import type { Tone } from '@/components/ui'

/**
 * The tag on a protocol row: how this asset is held, in one word. Debt gets
 * the block tone because it is the one row that makes the card smaller; the
 * rest are facts and stay neutral.
 */
export function heldTag(
  positionType: ProtocolPositionType,
  module: ProtocolModule | null,
): { label: string; tone: Tone } {
  if (positionType === 'loan') return { label: 'Debt', tone: 'block' }
  if (module === 'vesting' && positionType !== 'reward') return { label: 'Vesting', tone: 'neutral' }
  switch (positionType) {
    case 'deposit':
      return { label: 'Deposited', tone: 'neutral' }
    case 'staked':
      return { label: 'Staked', tone: 'neutral' }
    case 'locked':
      return { label: 'Locked', tone: 'neutral' }
    case 'reward':
      return { label: 'Reward', tone: 'ok' }
    case 'investment':
      return { label: 'Investment', tone: 'neutral' }
  }
}

/** What kind of thing a group is, for its header. Null when the provider did not say. */
export function moduleLabel(module: ProtocolModule | null): string | null {
  switch (module) {
    case 'deposit':
      return 'Deposit'
    case 'lending':
      return 'Lending'
    case 'yield':
      return 'Yield'
    case 'liquidity_pool':
      return 'Liquidity pool'
    case 'staked':
      return 'Staking'
    case 'leveraged_farming':
      return 'Leveraged farming'
    case 'nft_staked':
      return 'NFT staking'
    case 'farming':
      return 'Farming'
    case 'locked':
      return 'Locked'
    case 'vesting':
      return 'Vesting'
    case 'rewards':
      return 'Rewards'
    case 'investment':
      return 'Investment'
    case null:
      return null
  }
}

/**
 * The group's header line: its module when the name does not already say it.
 * "Fluid Lending (#9468)" needs no "Lending" beside it; "USDC/WETH" needs
 * "Liquidity pool".
 */
export function groupKind(group: Pick<PositionGroup, 'name' | 'module'>): string | null {
  const label = moduleLabel(group.module)
  if (!label) return null
  const first = label.split(' ')[0]!.toLowerCase()
  return group.name.toLowerCase().includes(first) ? null : label
}
