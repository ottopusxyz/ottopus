'use client'

import { useState } from 'react'
import { cn } from '@/lib/cn'
import { agentBrand } from './agent-brand'

/**
 * The agent's own mark, on a tile.
 *
 * The marks live in public/agents — see the README there for where they came
 * from and why the fallback is a generic bot rather than a nearest guess.
 *
 * The tile is cream in both themes rather than following the surface, which is
 * deliberate: these are third-party marks drawn for a light ground, and the
 * Anthropic one is #191919 — on the dark palette it would all but vanish.
 */
export function AgentIcon({
  name,
  redirectUris = [],
  size = 34,
  className,
}: {
  name: string
  redirectUris?: readonly string[]
  size?: number
  className?: string
}) {
  const brand = agentBrand(name, redirectUris)
  const [failed, setFailed] = useState(false)
  const key = failed ? 'other' : brand.icon

  return (
    <span
      aria-hidden
      style={{ width: size, height: size }}
      className={cn(
        'flex flex-none items-center justify-center overflow-hidden rounded-[10px]',
        'bg-[var(--ot-cream)] ring-1 ring-[var(--ot-border)]',
        className,
      )}
    >
      {/* A static asset from our own public directory, so next/image would add
          an optimiser round trip for a 300-byte SVG it cannot optimise anyway.
          onError covers a mark being removed without this map being updated. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={`/agents/${key}.svg`}
        alt=""
        width={size * 0.66}
        height={size * 0.66}
        onError={() => setFailed(true)}
      />
    </span>
  )
}
