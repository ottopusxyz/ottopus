import {
  AddressChip,
  Badge,
  Button,
  Callout,
  CalloutValue,
  Chip,
  EmptyState,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  PLAN_STATUSES,
  StatusChip,
  TokenAmount,
} from '@/components/ui'

/**
 * Ported from "Ottopus Design System.dc.html" in the design project. Structure
 * and rules follow that document; the values come from tokens.css, which is
 * what the app itself imports.
 *
 * Follows the system theme — flip your OS setting and nothing here should need
 * adjusting.
 */

const TYPE = [
  { face: 'Quicksand', role: 'Display', sample: 'Otto found 3 wallets', cls: 'font-display font-bold' },
  { face: 'Figtree', role: 'UI and body', sample: 'You send 500 USDC', cls: 'font-ui' },
  { face: 'JetBrains Mono', role: 'Addresses, hashes, amounts', sample: '0xd8da…6045', cls: 'font-mono' },
]

const STATE_MEANINGS = [
  { tone: 'plan' as const, label: 'Blue', meaning: 'Planning' },
  { tone: 'warn' as const, label: 'Amber', meaning: 'Caution' },
  { tone: 'ok' as const, label: 'Green', meaning: 'Confirmed' },
  { tone: 'block' as const, label: 'Red', meaning: 'Blocked' },
]

const RULES = [
  'Blue is planning, amber caution, green confirmed, red blocked. Everywhere. Always.',
  'Navy text on solid green, amber and blue — white fails AA on all three.',
  'Mono with tabular figures for every address, hash and amount.',
  'Plain-language headline first, exact number second, the fix as a button third.',
  'Say what was not done: "Nothing was signed." on every block or failure.',
  'Ambient motion lives in gutters and margins, never behind an amount or calldata.',
]

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card raised>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardBody>{children}</CardBody>
    </Card>
  )
}

export default function Styleguide() {
  const address = 'eip155:8453:0xd8da6bf26964af9d7eed9e03e53415d37aa96045'

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 px-6 py-12">
      <header>
        <h1 className="font-display text-[40px] font-bold tracking-[-0.03em]">Design system</h1>
        <p className="mt-1 text-[15px] text-[var(--ot-text-2)]">
          Tokens, primitives and the rules they encode. Follows your system theme.
        </p>
      </header>

      <Section title="Three faces">
        <div className="flex flex-col gap-4">
          {TYPE.map((t) => (
            <div key={t.face} className="flex flex-col gap-1">
              <div className="flex items-baseline gap-2 text-[11px] text-[var(--ot-text-3)]">
                <span className="font-medium text-[var(--ot-text-2)]">{t.face}</span>
                <span>· {t.role}</span>
              </div>
              <span className={`${t.cls} text-[26px] tracking-[-0.02em]`}>{t.sample}</span>
            </div>
          ))}
        </div>
      </Section>

      <Section title="State colours mean one thing">
        <div className="flex flex-col gap-2">
          {STATE_MEANINGS.map((s) => (
            <div key={s.tone} className="flex items-center gap-3">
              <Badge tone={s.tone}>{s.label}</Badge>
              <span className="text-[14px] text-[var(--ot-text-2)]">{s.meaning}</span>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Status">
        <div className="flex flex-wrap gap-2">
          {PLAN_STATUSES.map((s) => (
            <StatusChip key={s} status={s} />
          ))}
        </div>
      </Section>

      <Section title="Buttons">
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="primary">Link a wallet</Button>
          <Button variant="secondary">See an example</Button>
          <Button variant="ghost">Cancel</Button>
          <Button variant="link">Text action</Button>
          <Button variant="destructive">Revoke access</Button>
          <Button variant="primary" size="sm">
            Small
          </Button>
          <Button variant="primary" disabled>
            Disabled
          </Button>
        </div>
      </Section>

      <Section title="Warning banners">
        <div className="flex flex-col gap-3">
          <Callout
            severity="caution"
            title="This arm wants unlimited token access."
            actions={
              <>
                <Button variant="primary" size="sm">
                  Cap to 1,250
                </Button>
                <Button variant="secondary" size="sm">
                  Keep unlimited
                </Button>
              </>
            }
          >
            The approval is for <CalloutValue>2²⁵⁶−1 USDC</CalloutValue>. You are spending 1,250.
            Otto can cap it to exactly that.
          </Callout>
          <Callout severity="block" title="Ink. This contract was deployed 40 minutes ago.">
            Nothing was signed.
          </Callout>
          <Callout severity="info" title="Simulated on a fork 8 seconds ago." />
          <p className="text-[13px] text-[var(--ot-text-3)]">
            The title takes the state colour; the body stays full text colour, because the
            explanation is the part that has to be read carefully. A warning without an
            alternative just induces clicking.
          </p>
        </div>
      </Section>

      <Section title="Chips carry facts, not state">
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-2">
            <Chip>Ethereum</Chip>
            <Chip>Base</Chip>
            <Chip>Ledger</Chip>
            <Chip>Watch-only</Chip>
          </div>
          <p className="text-[13px] text-[var(--ot-text-3)]">
            Facts take the small radius, state takes the pill. Neither is ever a clickable
            filter — a chip that looks pressable implies a filter that does not exist.
          </p>
        </div>
      </Section>

      <Section title="Empty states">
        <EmptyState
          title="No plans yet"
          description="Tell your agent what you want done. Otto will work out which arm should do it."
          action={<Button variant="primary">Link a wallet</Button>}
        />
      </Section>

      <Section title="Addresses and amounts">
        <div className="flex flex-col items-start gap-3">
          <AddressChip address={address} />
          <AddressChip address={address} full />
          <TokenAmount value="1234567800" decimals={6} symbol="USDC" direction="out" />
          <TokenAmount value="123400000000000000" decimals={18} symbol="ETH" direction="in" />
          <TokenAmount value="1" decimals={18} symbol="ETH" />
          <p className="text-[13px] text-[var(--ot-text-3)]">
            Truncated for recognition, full where a value is being checked. Dust renders as a
            bound, never as zero.
          </p>
        </div>
      </Section>

      <Section title="Ambient motion">
        <div className="flex flex-col gap-4">
          <div className="flex gap-4">
            <div className="ot-depth relative h-28 flex-1 overflow-hidden rounded-[var(--ot-radius-md)]">
              <div className="ot-caustic" />
              <span className="ot-bubble ot-bubble--lg" style={{ left: 24, bottom: 8, width: 10, height: 10 }} />
              <span className="ot-bubble ot-bubble--md" style={{ left: 56, bottom: 8, width: 7, height: 7 }} />
              <span className="ot-bubble ot-bubble--sm" style={{ left: 84, bottom: 8, width: 5, height: 5 }} />
              <span className="absolute bottom-2 left-3 text-[11px] text-[var(--ot-text-3)]">
                running
              </span>
            </div>
            <div
              data-stillness="held"
              className="ot-depth relative h-28 flex-1 overflow-hidden rounded-[var(--ot-radius-md)]"
            >
              <div className="ot-caustic" />
              <span className="ot-bubble ot-bubble--lg" style={{ left: 24, bottom: 30, width: 10, height: 10 }} />
              <span className="ot-bubble ot-bubble--md" style={{ left: 56, bottom: 44, width: 7, height: 7 }} />
              <span className="ot-bubble ot-bubble--sm" style={{ left: 84, bottom: 20, width: 5, height: 5 }} />
              <span className="absolute bottom-2 left-3 text-[11px] text-[var(--ot-text-3)]">
                data-stillness=&quot;held&quot;
              </span>
            </div>
          </div>
          <div className="ot-shimmer h-4 w-2/3 rounded-[var(--ot-radius-sm)]" />
          <p className="text-[13px] text-[var(--ot-text-3)]">
            Stillness is how the product raises its voice. Everything above stops under reduced
            motion too.
          </p>
        </div>
      </Section>

      <Section title="Rules">
        <ul className="flex flex-col gap-2">
          {RULES.map((r) => (
            <li key={r} className="flex gap-2 text-[14px] text-[var(--ot-text-2)]">
              <span aria-hidden className="text-[var(--ot-coral)]">
                —
              </span>
              {r}
            </li>
          ))}
        </ul>
      </Section>

      <p className="text-[13px] text-[var(--ot-text-3)]">
        Otto, the lockups and the badge tiers land with #48.
      </p>
    </main>
  )
}
