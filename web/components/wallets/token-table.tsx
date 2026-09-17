/**
 * The tokens view, before the portfolio connector exists.
 *
 * Deliberately anonymous placeholder rows — no token names, no chains. A
 * plausible-looking "USDC · Base · $8,240" would be read as a holding, and a
 * balance someone believes is the one thing this screen must never invent. Dashes
 * and zeroes cannot be mistaken for data.
 *
 * The grid matches the real table it becomes, so nothing shifts when #8 lands.
 */

const COLUMNS = 'grid-cols-[minmax(0,1.5fr)_100px_70px] sm:grid-cols-[minmax(0,1.5fr)_130px_90px_130px]'

const PLACEHOLDER_ROWS = 3

export function TokenTable() {
  return (
    <div className="flex flex-col px-5 pb-5 tabular-nums sm:px-[26px]">
      <div
        className={`grid ${COLUMNS} gap-3.5 py-3 text-[12px] text-[var(--ot-text-3)] sm:gap-3.5`}
      >
        <span>Asset</span>
        <span className="text-right">Balance</span>
        <span className="text-right">Share</span>
        <span className="hidden text-right sm:block">Value</span>
      </div>

      {Array.from({ length: PLACEHOLDER_ROWS }, (_, i) => (
        <div
          key={i}
          aria-hidden
          className={`grid ${COLUMNS} items-center gap-3.5 border-t border-[var(--ot-border)] py-3`}
        >
          <div className="flex items-center gap-3">
            <span className="h-[34px] w-[34px] flex-none rounded-full bg-[var(--ot-surface-3)]" />
            <div className="flex flex-col gap-1">
              <span className="block h-[9px] w-[92px] rounded-[3px] bg-[var(--ot-surface-3)]" />
              <span className="block h-[8px] w-[64px] rounded-[3px] bg-[var(--ot-surface-3)]" />
            </div>
          </div>
          <code className="text-right font-mono text-[14px] font-semibold text-[var(--ot-text-4)]">
            $0.00
          </code>
          <span className="text-right text-[13px] text-[var(--ot-text-4)]">—</span>
          <code className="hidden text-right font-mono text-[14px] text-[var(--ot-text-4)] sm:block">
            —
          </code>
        </div>
      ))}

      <p className="border-t border-[var(--ot-border)] pt-4 text-[12.5px] leading-[1.5] text-[var(--ot-text-2)]">
        Balances aren’t connected yet. Your arms are linked and Otto knows about them — reading
        what’s in them arrives with the portfolio connector.
      </p>
    </div>
  )
}
