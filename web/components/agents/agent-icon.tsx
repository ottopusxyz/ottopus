import { cn } from '@/lib/cn'
import { agentBrand, type AgentSurface } from './agent-brand'

/**
 * Original marks, not vendor logos.
 *
 * Deliberate: the agent's name is self-asserted at registration, so painting a
 * company's logo next to it would vouch for a claim nothing verified — anyone
 * who can POST to /register may call themselves Claude. These say what kind of
 * thing it is, which is read off the callback URI and is the half nobody gets
 * to choose. The vendor shows in the tint and in the name beside it.
 */
const GLYPHS: Record<AgentSurface, React.ReactNode> = {
  // A terminal: prompt caret and a line.
  cli: (
    <>
      <rect x="2.5" y="4" width="19" height="16" rx="3" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path d="m7 9.5 3 2.5-3 2.5M12.5 15h4.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </>
  ),
  // An application window: title bar and body.
  desktop: (
    <>
      <rect x="2.5" y="4" width="19" height="16" rx="3" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path d="M2.5 8.5h19" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="5.8" cy="6.3" r="0.9" fill="currentColor" />
    </>
  ),
  // A globe: the meridian is what stops it reading as a plain circle.
  web: (
    <>
      <circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <ellipse cx="12" cy="12" rx="3.6" ry="8.5" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <path d="M3.5 12h17" stroke="currentColor" strokeWidth="1.4" />
    </>
  ),
  // Nothing claimed and nothing inferred: a plain chat bubble.
  unknown: (
    <>
      <path
        d="M3.5 11c0-3.6 3.4-6.5 8.5-6.5s8.5 2.9 8.5 6.5-3.4 6.5-8.5 6.5c-1 0-2-.1-2.9-.3L5 19.4l.8-3.2C4.4 15 3.5 13.1 3.5 11Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </>
  ),
}

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
  return (
    <span
      aria-hidden
      style={{ width: size, height: size, background: brand.bg, color: brand.fg }}
      className={cn('flex flex-none items-center justify-center rounded-[10px]', className)}
    >
      <svg viewBox="0 0 24 24" width={size * 0.62} height={size * 0.62}>
        {GLYPHS[brand.surface]}
      </svg>
    </span>
  )
}
