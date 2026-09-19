import { ReviewView } from '@/components/review'

export const metadata = { title: 'Review · Ottopus' }

/**
 * P4 — the review page. The URL segment is an opaque token, never a plan id,
 * and everything shown is read back from the service against it. Next renders
 * what the service verified and checks nothing itself.
 */
export default async function ReviewPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  return <ReviewView token={token} />
}
