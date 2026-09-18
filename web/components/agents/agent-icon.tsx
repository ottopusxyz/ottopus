'use client'

import { useState } from 'react'
import { cn } from '@/lib/cn'
import { agentBrand, type AgentIconKey } from './agent-brand'

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
  iconKey,
  size = 34,
  className,
}: {
  name: string
  redirectUris?: readonly string[]
  /**
   * Skip the guess. The connect dialog already knows which mark each of its
   * own pills wants, and re-deriving it from a display label is a round trip
   * that can only lose — as it did, drawing the bot for "VS Code".
   */
  iconKey?: AgentIconKey
  size?: number
  className?: string
}) {
  const [failed, setFailed] = useState(false)
  const key = failed ? 'other' : (iconKey ?? agentBrand(name, redirectUris).icon)

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
