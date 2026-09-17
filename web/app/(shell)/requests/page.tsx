import { Otto } from '@/components/brand'
import { PageHeader } from '@/components/shell'
import { EmptyState } from '@/components/ui'

export const metadata = { title: 'Requests · Ottopus' }

/** #54 fills this. The shell and the empty state are what the route needs today. */
export default function Requests() {
  return (
    <>
      <PageHeader title="Requests" detail="Plans waiting on you." />
      <div className="px-5 py-10 sm:px-[26px]">
        <EmptyState
          title="Calm waters"
          description="Nothing is waiting. Otto surfaces here when your agent asks for something."
          illustration={<Otto pose="base" size={150} animated />}
        />
      </div>
    </>
  )
}
