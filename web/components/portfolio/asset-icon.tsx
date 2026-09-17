'use client'

import { useState } from 'react'
import { cn } from '@/lib/cn'

/** Provider artwork with a stable fallback when a CDN image is missing or fails. */
export function AssetIcon({ url, name, size = 24, className }: {
  url?: string | null; name: string; size?: number; className?: string
}) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null)
  return (
    <span aria-hidden style={{ width: size, height: size }}
      className={cn('inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-[var(--ot-surface-3)] text-[10px] font-semibold ring-1 ring-[var(--ot-border)]', className)}>
      {url && failedUrl !== url ? (
        // Provider CDN URLs are dynamic; the image keeps its original aspect ratio.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt="" width={size} height={size} loading="lazy"
          className="h-full w-full object-contain" onError={() => setFailedUrl(url)} />
      ) : name.slice(0, 2).toUpperCase()}
    </span>
  )
}
