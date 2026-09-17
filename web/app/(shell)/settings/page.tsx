import { PageHeader } from '@/components/shell'

export const metadata = { title: 'Settings · Ottopus' }

/** #27 fills this: linked wallets, agent grants and their revocation. */
export default function Settings() {
  return (
    <>
      <PageHeader title="Settings" detail="Wallets, agents and what they may do." />
      <p className="px-5 py-10 text-[14px] text-[var(--ot-text-2)] sm:px-[26px]">
        Nothing to configure until a wallet is linked.
      </p>
    </>
  )
}
