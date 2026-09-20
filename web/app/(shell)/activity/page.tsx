import { ActivityView } from '@/components/activity/activity-view'
import { PageColumn, PageHeader } from '@/components/shell'

export const metadata = { title: 'Activity · Ottopus' }

/** #26: what every linked wallet did on chain, whoever prepared it. */
export default function Activity() {
  return (
    <PageColumn>
      <PageHeader title="Activity" detail="What your wallets did on chain, every network together, newest first." />
      <ActivityView />
    </PageColumn>
  )
}
