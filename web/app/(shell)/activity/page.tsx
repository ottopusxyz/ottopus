import { Otto } from '@/components/brand'
import { PageHeader } from '@/components/shell'
import { EmptyState } from '@/components/ui'

export const metadata = { title: 'Activity · Ottopus' }

/** #26 fills this. */
export default function Activity() {
  return (
    <>
      <PageHeader title="Activity" detail="Everything that has been decided." />
      <div className="px-5 py-10 sm:px-[26px]">
        <EmptyState
          title="Nothing yet"
          description="Signed, rejected and expired plans land here."
          illustration={<Otto pose="base" size={150} animated />}
        />
      </div>
    </>
  )
}
