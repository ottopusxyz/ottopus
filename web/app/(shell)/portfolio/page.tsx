import { Otto } from '@/components/brand'
import { BubbleField } from '@/components/motion'
import { Figure, FirstIntentNudge, PageHeader, TabBar } from '@/components/shell'
import { Button, Chip, EmptyState } from '@/components/ui'

export const metadata = { title: 'Portfolio · Ottopus' }

/**
 * The frame, with the numbers still to come from #8 and #9.
 *
 * The token section shows the empty state rather than skeletons: nothing is
 * loading, because nothing is linked. A skeleton here would promise data that
 * is never going to arrive.
 *
 * This is one of the three places water is allowed, and the only one where the
 * gradient, the bubbles and an animated Otto appear together.
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

      <div className="ot-canvas relative flex flex-1 items-center justify-center overflow-hidden px-5 py-7">
        <BubbleField pattern="calm" />
        <EmptyState
          className="relative"
          title="No wallets yet"
          description="Link a wallet and I’ll start keeping an eye on it. Up to eight."
          illustration={<Otto pose="base" size={120} animated />}
          action={
            <Button variant="primary" size="sm">
              Link wallet
            </Button>
          }
        />
      </div>

      <FirstIntentNudge />
    </>
  )
}
