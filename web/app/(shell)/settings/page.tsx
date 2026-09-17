import { PageHeader } from '@/components/shell'
import { WalletsPanel } from '@/components/wallets'

export const metadata = { title: 'Settings · Ottopus' }

/** Agent grants and their revocation land here in #27. */
export default function Settings() {
  return (
    <>
      <PageHeader title="Settings" detail="Wallets, agents and what they may do." />
      <section className="flex flex-col">
        <h2 className="px-5 pt-6 pb-3 text-[13px] font-semibold tracking-[0.04em] text-[var(--ot-text-2)] uppercase sm:px-[26px]">
          Wallets
        </h2>
        <WalletsPanel />
      </section>
    </>
  )
}
