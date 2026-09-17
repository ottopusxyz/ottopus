import { SkeletonRow } from '@/components/motion'
import { Figure, PageHeader, TabBar } from '@/components/shell'
import { Button, Chip } from '@/components/ui'

export const metadata = { title: 'Portfolio · Ottopus' }

/**
 * The frame, with the numbers still to come from #8 and #9. The skeletons are
 * not decoration: they hold the row height the real data will take, so landing
 * here before the connector exists shows the shape rather than a blank panel.
 */
export default function Portfolio() {
  return (
    <>
      <PageHeader
        title="Portfolio"
        eyebrow="Total balance"
        headline={<Figure whole="$0" fraction="00" />}
        detail="No wallets linked yet."
        action={
          <Button variant="secondary" size="sm">
            Link wallet
          </Button>
        }
      />
      <TabBar
        label="Portfolio views"
        tabs={[
          { value: 'tokens', label: 'Tokens' },
          { value: 'wallets', label: 'Wallets' },
          { value: 'approvals', label: 'Approvals', disabled: true },
        ]}
        aside={<Chip>All networks</Chip>}
      />
      <div className="flex flex-col gap-4 px-5 py-5 sm:px-[26px]">
        <SkeletonRow label="Loading balances" />
        <SkeletonRow label={null} />
        <SkeletonRow label={null} />
      </div>
    </>
  )
}
