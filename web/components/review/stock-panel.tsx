import { Badge } from '@/components/ui'
import { cn } from '@/lib/cn'
import type { StockPanelModel } from './model'

/**
 * The Stock panel: what this trade pays or receives per share, beside what
 * the share is worth, for a side of the trade that is a tokenized stock.
 *
 * Folded, it is one row: the symbol, the market's state, the per-share
 * figure and how far it sits from the reference. That is the decision, and
 * it stays above the button on a phone. Opened, it shows the reference the
 * gap is measured against, when it was read, what the quote came to and
 * when regular hours change. A native expander, like Advanced review, so it
 * needs no state and opens in place.
 *
 * Everything on it comes from the plan's hashed stock section, so the
 * figures the person reads are the figures the plan was judged on. The
 * premium is coloured by the same threshold the service warns at, in the
 * direction that matters to this person: over the reference hurts a buyer,
 * under it hurts a seller.
 */
export function StockPanel({ stock }: { stock: StockPanelModel }) {
  const perShare = 'value' in stock.effective ? stock.effective.value : null
  return (
    <details
      aria-label={`${stock.symbol} stock`}
      className="ot-review-details mx-[18px] mt-3.5 rounded-[12px] border border-[var(--ot-border)]"
    >
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3.5 py-2.5 [&::-webkit-details-marker]:hidden">
        <span className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1">
          <span className="text-[13.5px] font-semibold">{stock.symbol}</span>
          <Badge tone={stock.market.tone}>{stock.market.label}</Badge>
        </span>
        <span className="flex shrink-0 items-center gap-2">
          <span className="flex flex-col items-end gap-px text-right">
            <span className="font-mono text-[13.5px] font-semibold tabular-nums">{perShare ?? '—'}</span>
            <span className="text-[11px] text-[var(--ot-text-3)]">{stock.side === 'buy' ? 'you pay per share' : 'you get per share'}</span>
          </span>
          {stock.premium ? (
            <Badge tone={stock.premium.tone} className="font-mono tabular-nums">
              {stock.premium.value}
            </Badge>
          ) : null}
          <span className="ot-review-caret text-[var(--ot-text-3)]" aria-hidden>
            ▾
          </span>
        </span>
      </summary>

      <div className="flex flex-col gap-3 border-t border-[var(--ot-border)] px-3.5 py-3">
        <p className="m-0 text-[11.5px] text-[var(--ot-text-3)]">
          {stock.title} · {stock.issuer}
        </p>

        <dl className="m-0 grid grid-cols-2 gap-x-3 gap-y-0">
          <div className="flex flex-col gap-px">
            <dt className="text-[11.5px] text-[var(--ot-text-2)]">{stock.reference?.label ?? 'Reference price'}</dt>
            <dd className="m-0 font-mono text-[15px] font-semibold tabular-nums">{stock.reference?.value ?? '—'}</dd>
            <dd className="m-0 text-[11px] text-[var(--ot-text-3)]">{stock.reference?.readAt ?? 'none from the data source'}</dd>
          </div>
          <div className="flex flex-col gap-px text-right">
            <dt className="text-[11.5px] text-[var(--ot-text-2)]">{stock.effective.label}</dt>
            {'value' in stock.effective ? (
              <>
                <dd className="m-0 font-mono text-[15px] font-semibold tabular-nums">{stock.effective.value}</dd>
                <dd className="m-0 text-[11px] text-[var(--ot-text-3)]">{stock.effective.detail}</dd>
              </>
            ) : (
              <dd className="m-0 text-[11px] text-[var(--ot-text-3)]">{stock.effective.missing}</dd>
            )}
          </div>
        </dl>

        {stock.premium ? (
          <p className="m-0 flex items-center gap-2 text-[12.5px]">
            <Badge tone={stock.premium.tone} className={cn('font-mono tabular-nums')}>
              {stock.premium.value}
            </Badge>
            <span className="text-[var(--ot-text-2)]">{stock.premium.words}</span>
          </p>
        ) : null}

        {stock.next || stock.stale ? (
          <p className="m-0 text-[11.5px] leading-[1.45] text-[var(--ot-text-3)]">
            {[stock.stale, stock.next].filter(Boolean).join(' ')}
          </p>
        ) : null}
      </div>
    </details>
  )
}
