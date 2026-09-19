import { PageColumn, PageHeader } from '@/components/shell'
import { RequestsView } from '@/components/requests/requests-view'

export const metadata = { title: 'Requests · Ottopus' }

export default function Requests() {
  return <PageColumn><PageHeader title="Requests" detail="Every request an agent has made, the ones waiting on you first." /><RequestsView /></PageColumn>
}
