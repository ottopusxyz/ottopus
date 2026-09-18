import { AgentsPanel } from '@/components/agents'
import { SessionAccountPanel } from '@/components/auth'
import { PageColumn, PageHeader } from '@/components/shell'
import { WalletsPanel } from '@/components/wallets'

export const metadata = { title: 'Settings · Ottopus' }

/**
 * P6 in the design, with one departure. The design draws two cards in an
 * auto-fit grid that goes two-up above ~1130px. This page has three — the
 * account card exists so a phone has somewhere to sign out — and three cards
 * in a two-column grid orphan one on its own row. One column, capped, instead:
 * the design's own layout below 1130px at every width.
 *
 * Centred as a whole — header and cards in one column that shares its edges —
 * like every shell page that is not the portfolio. See PageColumn.
 */
export default function Settings() {
  return (
    <PageColumn>
      {/* The design's line for this screen, verbatim. */}
      <PageHeader
        title="Settings"
        detail="Everything here is revocable, and revoking says what it costs you."
      />
      <div className="flex flex-col gap-4 px-5 py-5 sm:px-[26px] sm:py-6">
        {/* Agents first, as the design orders them: an agent is the thing that
            acts, and a wallet is what it acts with. */}
        <AgentsPanel />
        <WalletsPanel />
        {/* Last: agents and wallets are what this page is for, and the account
            block is housekeeping. It is also the only home sign-out has below
            lg, where the sidebar that carries it is not on screen. */}
        <SessionAccountPanel />
      </div>
    </PageColumn>
  )
}
