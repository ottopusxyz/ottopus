import { Skeleton, SkeletonRow, SkeletonText } from '@/components/motion'

/**
 * The card before the plan arrives, in the card's own shape. The session
 * loader already ran once on the way in; a second Otto would be a second
 * wait announced twice. Tide sweeps the headline; the rest holds still.
 */
export function ReviewSkeleton() {
  return (
    <article
      aria-busy
      className="flex flex-col overflow-hidden rounded-[26px] border border-[var(--ot-border-strong)] bg-[var(--ot-card)] shadow-[var(--ot-shadow-card)] sm:rounded-[16px] sm:border-[var(--ot-border)]"
    >
      <header className="flex items-center justify-between px-[18px] pt-4 pb-1.5">
        <Skeleton width={56} height={16} sweep={false} />
        <Skeleton width={96} height={12} sweep={false} />
      </header>
      <div className="flex flex-col gap-2 px-[18px] pt-1.5 pb-3.5">
        <SkeletonText lines={2} lineHeight={22} widths={['88%', '62%']} label="Loading the request" />
        <Skeleton height={14} width="76%" sweep={false} delay={0.2} />
      </div>
      <div className="flex flex-col gap-3 bg-[var(--ot-water-1)] px-[18px] py-3.5">
        <Skeleton width={140} height={12} sweep={false} />
        <SkeletonRow avatar={36} label={null} />
        <Skeleton height={34} radius={8} sweep={false} delay={0.3} />
      </div>
      <div className="flex flex-col px-[18px]">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="flex items-center justify-between border-t border-[var(--ot-border)] py-[13px]">
            <Skeleton width={90} height={13} sweep={false} />
            <Skeleton width={120} height={13} sweep={false} />
          </div>
        ))}
      </div>
      <div className="mt-3.5 flex flex-col gap-3 border-t border-[var(--ot-border)] bg-[var(--ot-water-1)] px-[18px] pt-3.5 pb-[18px]">
        <Skeleton height={58} radius={10} sweep={false} />
        <div className="flex gap-2">
          <Skeleton height={44} radius={999} sweep={false} />
          <Skeleton height={44} radius={999} delay={0.4} />
        </div>
      </div>
    </article>
  )
}
