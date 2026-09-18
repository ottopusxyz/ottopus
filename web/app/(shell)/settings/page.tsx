import { AgentsPanel } from '@/components/agents'
import { SessionAccountPanel } from '@/components/auth'
import { PageHeader } from '@/components/shell'
import { WalletsPanel } from '@/components/wallets'

export const metadata = { title: 'Settings · Ottopus' }

export default function Settings() {
  return (
    <>
      <PageHeader title="Settings" detail="Wallets, agents and what they may do." />
      <div className="grid gap-4 px-5 py-5 sm:px-[26px] sm:py-6 lg:grid-cols-[repeat(auto-fit,minmax(400px,1fr))]">
        <WalletsPanel />
        <AgentsPanel />
        {/* Last: wallets and agents are what this page is for, and the account
            block is housekeeping. It is also the only home sign-out has below
            lg, where the sidebar that carries it is not on screen. */}
        <SessionAccountPanel />
      </div>
    </>
  )
}
