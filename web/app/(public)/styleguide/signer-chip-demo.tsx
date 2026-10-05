'use client'

import { SignerChip } from '@/components/review/signer-chip'
import { signerStatus, type Gate, type SignerContext } from '@/components/review/wallet-gate'
import { walletMark } from '@/components/wallets/naming'

const WANTED = '0xc3501234abcd5678ef901234abcd5678ef903e7b'
const OTHER = '0x71c01234abcd5678ef901234abcd5678ef90a4f2'
const metamask = { name: 'MetaMask', icon: walletMark('metamask') }
const base = { name: 'Base', icon: walletMark('base_account') }

const ctx: SignerContext = {
  signerName: 'Main (0xc350…3e7b)',
  wantedShort: '0xc350…3e7b',
  connectedShort: '0x71c0…a4f2',
  chainName: 'BNB Chain',
  onChainName: 'Base',
  wallet: { name: 'MetaMask', kind: 'installed' },
}

const STATES: { gate: Gate; ctx: SignerContext; wallet: typeof metamask | null }[] = [
  { gate: { kind: 'connect', wanted: WANTED }, ctx: { ...ctx, wallet: null }, wallet: null },
  { gate: { kind: 'ready', address: WANTED, chain: 'eip155:56' }, ctx, wallet: metamask },
  { gate: { kind: 'wrong_chain', wanted: WANTED, chain: 'eip155:56', on: 'eip155:8453' }, ctx, wallet: metamask },
  { gate: { kind: 'wrong_account', wanted: WANTED, connected: OTHER }, ctx, wallet: metamask },
  {
    gate: { kind: 'wrong_account', wanted: WANTED, connected: OTHER },
    ctx: { ...ctx, wallet: { name: 'Base', kind: 'sdk' } },
    wallet: base,
  },
]

/** The wallet strip under the review page's buttons, once per gate. */
export function SignerChipDemo() {
  return (
    <div className="flex max-w-[400px] flex-col gap-3">
      {STATES.map((state, i) => (
        <SignerChip key={i} status={signerStatus(state.gate, state.ctx)} wallet={state.wallet} onDisconnect={() => {}} />
      ))}
    </div>
  )
}
