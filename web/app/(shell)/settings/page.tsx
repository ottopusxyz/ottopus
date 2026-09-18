import { AgentsPanel } from '@/components/agents'
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
      </div>
    </>
  )
}
