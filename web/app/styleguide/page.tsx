import { Lockup, Otto, OttoBadge, POSE_NAMES } from '@/components/brand'
import { ThemeToggle } from '@/components/theme-toggle'
import { cn } from '@/lib/cn'
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

const BRAND = ['coral', 'coral-hover', 'coral-soft', 'coral-text', 'cream', 'navy']
const SURFACES = ['page', 'surface', 'card', 'surface-2', 'surface-3']
const TEXT = ['text', 'text-2', 'text-3', 'text-4']
const LINES = ['border', 'border-strong']
const DEPTH = ['card', 'water-1', 'water-2', 'water-3']

/** Each state owns four tokens: a tint, a border, a text colour and a solid. */
const STATES = [
  { name: 'plan', means: 'Planning' },
  { name: 'warn', means: 'Caution' },
  { name: 'ok', means: 'Confirmed' },
  { name: 'block', means: 'Blocked' },
]

function Swatch({ token, wide = false }: { token: string; wide?: boolean }) {
  return (
    <div className="flex flex-col gap-1">
      <div
        className={cn(
          'h-11 rounded-[var(--ot-radius-sm)] border border-[var(--ot-border)]',
          wide ? 'w-32' : 'w-20',
        )}
        style={{ background: `var(--ot-${token})` }}
      />
      <code className="font-mono text-[10px] text-[var(--ot-text-3)]">--ot-{token}</code>
    </div>
  )
}

function SwatchRow({ label, tokens }: { label: string; tokens: string[] }) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-[11px] tracking-[0.14em] text-[var(--ot-text-3)] uppercase">
        {label}
      </span>
      <div className="flex flex-wrap gap-2">
        {tokens.map((t) => (
          <Swatch key={t} token={t} />
        ))}
      </div>
    </div>
  )
}

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
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-[40px] font-bold tracking-[-0.03em]">Design system</h1>
          <p className="mt-1 text-[15px] text-[var(--ot-text-2)]">
            Tokens, primitives and the rules they encode.
          </p>
        </div>
        <ThemeToggle />
      </header>

      <Section title="Identity">
        <div className="flex flex-col gap-5">
          <div className="flex flex-wrap items-center gap-8">
            <Lockup layout="horizontal" size={44} />
            <Lockup layout="stacked" size={56} />
            <Lockup layout="wordmark" size={36} />
          </div>
          <div className="flex flex-wrap items-center gap-8 rounded-[var(--ot-radius-md)] bg-[var(--ot-navy)] p-5">
            <Lockup layout="horizontal" size={44} tone="reversed" />
            <Lockup layout="horizontal" size={44} tone="coral" />
          </div>
          <div className="flex items-end gap-5">
            {[64, 32, 24, 16].map((s) => (
              <div key={s} className="flex flex-col items-center gap-1">
                <OttoBadge size={s} tier={s < 24 ? 'icon' : 'outlined'} />
                <span className="text-[11px] text-[var(--ot-text-3)]">{s}</span>
              </div>
            ))}
          </div>
          <p className="text-[13px] text-[var(--ot-text-3)]">
            The lockup is the badge beside real text, never a flattened image. Below 24px the
            badge drops its ring and highlights — they turn to mud at that size.
          </p>
        </div>
      </Section>

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

      <Section title="Colour">
        <div className="flex flex-col gap-5">
          <SwatchRow label="Brand" tokens={BRAND} />
          <SwatchRow label="Surfaces" tokens={SURFACES} />
          <SwatchRow label="Text" tokens={TEXT} />
          <SwatchRow label="Lines" tokens={LINES} />

          <div className="flex flex-col gap-2">
            <span className="text-[11px] tracking-[0.14em] text-[var(--ot-text-3)] uppercase">
              State
            </span>
            <div className="flex flex-col gap-3">
              {STATES.map((st) => (
                <div key={st.name} className="flex flex-wrap items-end gap-2">
                  {[`${st.name}-bg`, `${st.name}-border`, `${st.name}-text`, st.name].map((t) => (
                    <Swatch key={t} token={t} />
                  ))}
                  <span className="pb-4 text-[13px] text-[var(--ot-text-2)]">{st.means}</span>
                </div>
              ))}
            </div>
            <div className="flex flex-wrap gap-2 pt-1">
              <Badge tone="neutral">Neutral</Badge>
              <Badge tone="plan">Simulated</Badge>
              <Badge tone="ok">Tasted</Badge>
              <Badge tone="warn">Heads up</Badge>
              <Badge tone="block">Blocked</Badge>
              <Badge tone="coral">Coral</Badge>
            </div>
            <p className="text-[13px] text-[var(--ot-text-3)]">
              Blue is planning, amber caution, green confirmed, red blocked. Everywhere, always.
              Badges pair a tint with darker text of the same hue; text on any solid fill goes
              through --ot-on-state, because white fails AA on all four.
            </p>
          </div>

          <div className="flex flex-col gap-2">
            <span className="text-[11px] tracking-[0.14em] text-[var(--ot-text-3)] uppercase">
              Depth
            </span>
            <div className="flex flex-wrap gap-2">
              {DEPTH.map((t) => (
                <Swatch key={t} token={t} wide />
              ))}
            </div>
            <p className="text-[13px] text-[var(--ot-text-3)]">
              Four steps, each about 2% darker. Depth carries hierarchy where a border would add
              noise — the review layers, nested detail, the technical drawer.
            </p>
          </div>
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
        <div className="flex flex-col gap-5">
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="primary">Approve and sign</Button>
            <Button variant="secondary">Ask Otto to re-plan</Button>
            <Button variant="ghost">Cancel</Button>
            <Button variant="link">Text action</Button>
          </div>

          <div className="flex flex-col gap-2">
            <span className="text-[11px] tracking-[0.14em] text-[var(--ot-text-3)] uppercase">
              Destructive
            </span>
            <div className="flex flex-wrap items-center gap-3">
              <Button variant="destructive">Revoke grant</Button>
              <Button variant="destructive">Unlink this wallet</Button>
              <Button variant="danger-outline">Reject</Button>
            </div>
            <p className="text-[13px] text-[var(--ot-text-3)]">
              Solid is for the committed act, where destruction is the point of the button.
              Outline is for rejecting beside an approve — red on red would compete with the
              primary action for the eye.
            </p>
          </div>

          <div className="flex flex-col gap-2">
            <span className="text-[11px] tracking-[0.14em] text-[var(--ot-text-3)] uppercase">
              Sizes
            </span>
            <div className="flex flex-wrap items-center gap-3">
              <Button variant="primary" size="sm">
                Small
              </Button>
              <Button variant="primary" size="md">
                Medium
              </Button>
              <Button variant="primary" size="lg">
                Large
              </Button>
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <span className="text-[11px] tracking-[0.14em] text-[var(--ot-text-3)] uppercase">
              Disabled
            </span>
            <div className="flex flex-wrap items-center gap-3">
              <Button variant="primary" disabled>
                Approve and sign
              </Button>
              <Button variant="secondary" disabled>
                Re-plan
              </Button>
              <Button variant="destructive" disabled>
                Revoke
              </Button>
            </div>
            <p className="text-[13px] text-[var(--ot-text-3)]">
              Disabled goes neutral rather than faded. A washed coral still reads as the primary
              action; a plain surface reads as unavailable.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3 rounded-[var(--ot-radius-md)] bg-[var(--ot-navy)] p-4">
            <Button variant="primary">Review and sign</Button>
            <Button variant="secondary">Re-plan</Button>
            <span className="text-[12px] text-[var(--ot-cream)] opacity-70">
              on navy, unchanged
            </span>
          </div>
        </div>
      </Section>

      <Section title="Otto">
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-end gap-4">
            {POSE_NAMES.map((p) => (
              <div key={p} className="flex flex-col items-center gap-1">
                <Otto pose={p} size={84} />
                <span className="text-[11px] text-[var(--ot-text-3)]">{p}</span>
              </div>
            ))}
          </div>
          <div className="flex items-end gap-6">
            <div className="flex flex-col items-center gap-1">
              <Otto pose="base" size={84} animated label="Otto, drifting" />
              <span className="text-[11px] text-[var(--ot-text-3)]">animated</span>
            </div>
            <div className="flex flex-col items-center gap-1">
              <Otto pose="base" size={200} flat />
              <span className="text-[11px] text-[var(--ot-text-3)]">solid · 200px and up only</span>
            </div>
          </div>
          <p className="text-[13px] text-[var(--ot-text-3)]">
            The body colour is a token, so Otto moves with the palette in dark mode. Arms sway out
            of phase and stop under reduced motion — and under data-stillness. The solid treatment
            is for 200px and up: never an avatar, a favicon or a lockup.
          </p>
        </div>
      </Section>

      <Section title="Warning banners">
        <div className="flex flex-col gap-3">
          <Callout
            severity="caution"
            title="This arm wants unlimited token access."
            icon={<Otto pose="heads-up" size={44} />}
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
          <Callout
            severity="block"
            icon={<Otto pose="ink" size={44} />}
            title="Ink. This contract was deployed 40 minutes ago."
          >
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
          illustration={<Otto pose="base" size={150} animated />}
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
        Lockups, wordmarks and the badge tiers are still to come.
      </p>
    </main>
  )
}
