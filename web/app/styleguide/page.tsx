import {
  AddressChip,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  PLAN_STATUSES,
  StatusChip,
  TokenAmount,
} from '@/components/ui'

/**
 * Every primitive on one page, so a change can be seen rather than assumed.
 * Deliberately shows both light and dark by respecting the system setting —
 * flip your OS theme and nothing here should need adjusting.
 */
export default function Styleguide() {
  const address = 'eip155:8453:0xd8da6bf26964af9d7eed9e03e53415d37aa96045'

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-8 px-6 py-12">
      <header>
        <h1 className="font-display text-[28px] font-bold tracking-[-0.03em]">
          Components
        </h1>
        <p className="mt-1 text-[14px] text-[var(--ot-text-2)]">
          Ottopus primitives. Follows your system theme.
        </p>
      </header>

      <Card raised>
        <CardHeader>
          <CardTitle>Buttons</CardTitle>
        </CardHeader>
        <CardBody className="flex flex-wrap items-center gap-3">
          <Button variant="primary">Link a wallet</Button>
          <Button variant="secondary">See an example</Button>
          <Button variant="ghost">Cancel</Button>
          <Button variant="destructive">Revoke access</Button>
          <Button variant="primary" size="sm">
            Small
          </Button>
          <Button variant="primary" disabled>
            Disabled
          </Button>
        </CardBody>
      </Card>

      <Card raised>
        <CardHeader>
          <CardTitle>Status</CardTitle>
        </CardHeader>
        <CardBody className="flex flex-wrap gap-2">
          {PLAN_STATUSES.map((s) => (
            <StatusChip key={s} status={s} />
          ))}
        </CardBody>
      </Card>

      <Card raised>
        <CardHeader>
          <CardTitle>Badges</CardTitle>
        </CardHeader>
        <CardBody className="flex flex-wrap gap-2">
          <Badge tone="neutral">Neutral</Badge>
          <Badge tone="plan">Simulated</Badge>
          <Badge tone="ok">Tasted</Badge>
          <Badge tone="warn">Heads up</Badge>
          <Badge tone="block">Blocked</Badge>
          <Badge tone="coral">Coral</Badge>
        </CardBody>
      </Card>

      <Card raised>
        <CardHeader>
          <CardTitle>Addresses</CardTitle>
        </CardHeader>
        <CardBody className="flex flex-col items-start gap-3">
          <AddressChip address={address} />
          <AddressChip address={address} full />
          <p className="text-[13px] text-[var(--ot-text-3)]">
            Truncated for recognition, full where the value is being checked.
          </p>
        </CardBody>
      </Card>

      <Card raised>
        <CardHeader>
          <CardTitle>Amounts</CardTitle>
        </CardHeader>
        <CardBody className="flex flex-col gap-2">
          <TokenAmount value="1234567800" decimals={6} symbol="USDC" direction="out" />
          <TokenAmount value="123400000000000000" decimals={18} symbol="ETH" direction="in" />
          <TokenAmount value="1" decimals={18} symbol="ETH" />
          <p className="text-[13px] text-[var(--ot-text-3)]">
            Dust renders as a bound, never as zero.
          </p>
        </CardBody>
      </Card>
    </main>
  )
}
